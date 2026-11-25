// Envio Full Serena — API única (login usuário+PIN, QR do celular, envios, separação, estoque no Full)
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-full-token, x-full-qr, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
class Erro extends Error { constructor(m: string, public s = 400) { super(m); } }
const must = (c: unknown, m: string, s = 403) => { if (!c) throw new Erro(m, s); };
const q = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => { const { data, error } = await p; if (error) throw new Erro(error.message, 500); return data; };
const rnd = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");

type Me = { login: string; nome: string; role: string; qrEnvio?: string };

async function quem(req: Request): Promise<Me | null> {
  const t = req.headers.get("x-full-token"), qr = req.headers.get("x-full-qr"), int = req.headers.get("x-full-int");
  if (int) { const a = await mlAuth(); return a?.cron_token && a.cron_token === int ? { login: "sistema", nome: "Sincronização automática", role: "sistema" } : null; }
  if (t) {
    const s = await q(db.from("full_sessions").select("login,expira").eq("token", t).maybeSingle());
    if (!s || new Date(s.expira) < new Date()) return null;
    const u = await q(db.from("full_users").select("login,nome,role,ativo").eq("login", s.login).maybeSingle());
    return u && u.ativo ? { login: u.login, nome: u.nome, role: u.role } : null;
  }
  if (qr) {
    const k = await q(db.from("full_qr").select("envio,login,revogado").eq("token", qr).maybeSingle());
    if (!k || k.revogado) return null;
    const [e, u] = await Promise.all([
      q(db.from("full_envios").select("status").eq("id", k.envio).maybeSingle()),
      q(db.from("full_users").select("login,nome,role,ativo").eq("login", k.login).maybeSingle()),
    ]);
    if (!e || e.status !== "liberado") return null;
    return u && u.ativo ? { login: u.login, nome: u.nome, role: "expedicao", qrEnvio: k.envio } : null;
  }
  return null;
}
const log = (envio: string, msg: string) => db.from("full_log").insert({ envio, msg: String(msg).slice(0, 300) });
const toque = (id: string) => db.from("full_envios").update({ updated_at: new Date().toISOString() }).eq("id", id);

// ===== Mercado Livre (estoque no Full) =====
const ML = "https://api.mercadolibre.com";
const ML_ID = Deno.env.get("ML_CLIENT_ID") || "770978757588091";
const ML_REDIR = "https://envio-full-serena.vercel.app/";
const espera = (ms: number) => new Promise((z) => setTimeout(z, ms));
async function mlAuth() { return await q(db.from("full_ml_auth").select("*").eq("id", 1).maybeSingle()); }
async function mlOauth(body: Record<string, string>) {
  const sec = Deno.env.get("ML_CLIENT_SECRET");
  must(sec, "Falta cadastrar a ML_CLIENT_SECRET nos Secrets das Edge Functions do Supabase.", 500);
  const r = await fetch(`${ML}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: ML_ID, client_secret: sec!, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Erro(`Mercado Livre recusou a autorização: ${j.message || j.error || r.status}`, 400);
  return { access_token: j.access_token, refresh_token: j.refresh_token, expira: new Date(Date.now() + (j.expires_in || 21600) * 1000).toISOString(), user_id: j.user_id };
}
const mlLigado = (a: any) => !!(a?.refresh_token || (a?.access_token && new Date(a.expira).getTime() > Date.now()));
async function mlToken() {
  const a = await mlAuth(); must(mlLigado(a), "Conecte o Mercado Livre primeiro.", 400);
  if (a.access_token && new Date(a.expira).getTime() > Date.now() + 120000) return a;
  must(a.refresh_token, "A autorização do Mercado Livre expirou. Ative o acesso offline na aplicação do DevCenter e conecte de novo.", 401);
  try {
    const t = await mlOauth({ grant_type: "refresh_token", refresh_token: a.refresh_token });
    const n = { access_token: t.access_token, refresh_token: t.refresh_token || a.refresh_token, expira: t.expira, msg: null, updated_at: new Date().toISOString() };
    await q(db.from("full_ml_auth").update(n).eq("id", 1)); return { ...a, ...n };
  } catch (e) {
    await db.from("full_ml_auth").update({ msg: "A conexão com o Mercado Livre expirou. Conecte de novo." }).eq("id", 1); throw e;
  }
}
async function mlGet(a: any, path: string) {
  for (let t = 0; t < 4; t++) {
    const r = await fetch(ML + path, { headers: { authorization: `Bearer ${a.access_token}`, accept: "application/json" } });
    if (r.status === 429 || r.status >= 500) { await espera(2000 * 2 ** t); continue; }
    // ids das movimentações passam de 2^53: lê como texto para não perder precisão
    const txt = (await r.text()).replace(/"id"\s*:\s*(\d{16,})/g, '"id":"$1"');
    let j: any = {}; try { j = JSON.parse(txt); } catch { /* resposta vazia */ }
    if (!r.ok) throw new Erro(`Mercado Livre (${r.status}): ${j.message || path}`, 502);
    return j;
  }
  throw new Erro("O Mercado Livre limitou as consultas. Tente de novo em 1 minuto.", 429);
}
const unico = <T>(xs: T[], k: (x: T) => string) => [...new Map(xs.map((x) => [k(x), x])).values()];
async function emLotes<T>(xs: T[], n: number, fn: (x: T) => Promise<void>) { for (let i = 0; i < xs.length; i += n) await Promise.all(xs.slice(i, i + n).map(fn)); }
const multTitulo = (t: string) => { const m = t.match(/^(?:kit\s*(?:com\s*)?)?(\d+)\s*(?:x|un\.?|unid\w*|p[çc]s?)\s/i) || t.match(/\bkit\s*(?:com\s*)?(\d+)\s*(?:x|un\.?|unid\w*|p[çc]s?)?\s/i); return m ? Math.max(1, +m[1]) : 1; };

// o PostgREST devolve no máximo 1000 linhas por consulta: lê em páginas
async function todas(f: (de: number, ate: number) => PromiseLike<{ data: any; error: any }>) {
  const out: any[] = [];
  for (let de = 0; ; de += 1000) { const r = await q(f(de, de + 999)); out.push(...r); if (r.length < 1000) return out; }
}
const qtdIndisp = (x: any) => Array.isArray(x?.not_available_detail) && x.not_available_detail.length
  ? x.not_available_detail.reduce((s: number, d: any) => s + (+d.quantity || 0), 0) : +(x?.not_available_quantity ?? 0) || 0;

async function mlSync(diasHist = 0) {
  const t0 = Date.now();
  const a = await mlToken();
  // 1) anúncios com logística Full
  let ids: string[] = []; let scroll = "";
  for (let i = 0; i < 60; i++) {
    const j = await mlGet(a, `/users/${a.user_id}/items/search?logistic_type=fulfillment&search_type=scan&limit=100${scroll ? `&scroll_id=${scroll}` : ""}`);
    ids.push(...(j.results || [])); scroll = j.scroll_id; if (!(j.results || []).length || !scroll) break;
  }
  ids = [...new Set(ids)];
  const linhas: any[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const r = await mlGet(a, `/items?ids=${ids.slice(i, i + 20).join(",")}&attributes=id,title,inventory_id,status,seller_custom_field,attributes,variations`);
    for (const x of r) { const it = x.body || {}; if (x.code !== 200) continue;
      const skuAttr = (it.attributes || []).find((t: any) => t.id === "SELLER_SKU")?.value_name;
      const base = { item_id: it.id, titulo: it.title, status: it.status, sku: it.seller_custom_field || skuAttr || "" };
      if (it.inventory_id) linhas.push({ ...base, inv: it.inventory_id });
      for (const v of it.variations || []) if (v.inventory_id) linhas.push({ ...base, inv: v.inventory_id });
    }
  }
  // um mesmo inventory_id pode aparecer em mais de um anúncio/variação
  const ln = unico(linhas, (l: any) => l.inv); linhas.length = 0; linhas.push(...ln);
  // 2) estoque de cada anúncio no Full
  await emLotes(linhas, 6, async (l) => {
    const st = await mlGet(a, `/inventories/${l.inv}/stock/fulfillment`).catch(() => null);
    if (!st) { l.falhou = true; return; } // sem resposta: mantém o último saldo gravado
    l.total = st?.total ?? 0; l.disponivel = st?.available_quantity ?? 0; l.indisponivel = st?.not_available_quantity ?? 0;
    l.detalhe = st?.not_available_detail || []; l.updated_at = new Date().toISOString();
  });
  const lidas = linhas.filter((l) => !l.falhou);
  if (lidas.length) await q(db.from("full_ml_estoque").upsert(lidas));
  // 3) anúncios novos entram nos vínculos (código do ERP pelo SKU, kit pelo título ou sufixo do SKU)
  const ex = new Set((await q(db.from("full_vinc").select("inv"))).map((v: any) => v.inv));
  const novos = linhas.filter((l) => !ex.has(l.inv));
  if (novos.length) {
    const sk = (s: string) => String(s || "").match(/^(\d{4,6})(?:-0*(\d{1,3}))?$/);
    const cods = [...new Set(novos.map((l) => sk(l.sku)?.[1]).filter(Boolean))] as string[];
    const prods = cods.length ? await q(db.from("products").select("id,data").in("id", cods)) : [];
    const pm = new Map(prods.map((p: any) => [p.id, p]));
    const rows = novos.map((l) => { const m = sk(l.sku); const cod = m && pm.has(m[1]) ? m[1] : ""; const mult = m?.[2] ? Math.max(1, +m[2]) : multTitulo(l.titulo || "");
      return { inv: l.inv, cod, mult, updated_at: new Date().toISOString() }; });
    await q(db.from("full_vinc").upsert(rows));
    const erp = unico(rows.filter((r) => r.cod), (r) => r.cod).map((r) => { const p: any = pm.get(r.cod); return { cod: r.cod, nome: p?.data?.name || r.cod, ean: p?.data?.ean || "" }; });
    if (erp.length) await q(db.from("full_erp").upsert(erp, { onConflict: "cod", ignoreDuplicates: true }));
  }
  // 4) movimentações: da mais recente para a mais antiga, em blocos (janela de 30 dias × 20 anúncios).
  // O Mercado Livre limita esta consulta por cota; o cursor guarda o próximo bloco e a sincronização seguinte continua dali.
  const invs = linhas.map((l) => l.inv).sort();
  const D = 86400000, JAN = 30 * D, LOTE = 20;
  let cur = a.ops_cursor as { ini: string; fim: string; w: number; i: number } | null;
  if (diasHist > 0) cur = { ini: new Date(Date.now() - Math.min(diasHist, 730) * D).toISOString(), fim: new Date().toISOString(), w: 0, i: 0 };
  else if (!cur) cur = { ini: new Date(a.ops_ate ? new Date(a.ops_ate).getTime() - 2 * D : Date.now() - 120 * D).toISOString(), fim: new Date().toISOString(), w: 0, i: 0 };
  const ini = new Date(cur.ini).getTime(), fim = new Date(cur.fim).getTime();
  const nJan = Math.max(1, Math.ceil((fim - ini) / JAN));
  const dia = (t: number) => new Date(t).toISOString().slice(0, 10);
  const salva = (c: unknown) => q(db.from("full_ml_auth").update({ ops_cursor: c, ultima_sync: new Date().toISOString(), msg: null }).eq("id", 1));
  let nOps = 0;
  for (let w = cur.w; w < nJan; w++) {
    const w1 = fim - w * JAN, w0 = Math.min(Math.max(ini, w1 - JAN), w1 - D); // o ML exige date_from < date_to (em dias)
    for (let i = w === cur.w ? cur.i : 0; i < invs.length; i += LOTE) {
      if (Date.now() - t0 > 100000) { await salva({ ...cur, w, i }); return { anuncios: linhas.length, ops: nOps, parcial: true, ate: dia(w1) }; }
      let sc = "";
      try {
        for (let p = 0; p < 50; p++) {
          const j = await mlGet(a, `/stock/fulfillment/operations/search?seller_id=${a.user_id}&inventory_id=${invs.slice(i, i + LOTE).join(",")}&date_from=${dia(w0)}&date_to=${dia(w1)}&limit=1000${sc ? `&scroll=${sc}` : ""}`);
          const rs = j.results || [];
          if (rs.length) {
            const rows = unico(rs.map((o: any) => ({ id: o.id, inv: o.inventory_id, data: o.date_created, tipo: String(o.type || "").toLowerCase(),
              disp: +(o.detail?.available_quantity ?? 0) || 0, indisp: qtdIndisp(o.detail),
              saldo: o.result?.total ?? ((o.result?.available_quantity ?? 0) + (o.result?.not_available_quantity ?? 0)),
              ref: o.external_references || null, raw: { detail: o.detail || null, result: o.result || null } })), (o: any) => String(o.id));
            await q(db.from("full_ml_ops").upsert(rows)); nOps += rows.length;
          }
          sc = j.paging?.scroll || ""; if (!rs.length || !sc) break;
        }
      } catch (e) {
        if (e instanceof Erro && e.s === 429) { await salva({ ...cur, w, i }); return { anuncios: linhas.length, ops: nOps, parcial: true, ate: dia(w1) }; }
        throw e;
      }
      await salva({ ...cur, w, i: i + LOTE });
    }
  }
  await q(db.from("full_ml_auth").update({ ops_cursor: null, ultima_sync: new Date().toISOString(), ops_ate: cur.fim, msg: null }).eq("id", 1));
  return { anuncios: linhas.length, ops: nOps };
}

// ===== Devoluções: reclamações de devolução de vendas Full + entregas não concluídas que voltaram ao Full =====
const isoD = (x: any) => (x ? new Date(x).toISOString() : null);
const nao429 = (e: unknown) => { if (e instanceof Erro && e.s === 429) throw e; return null; };
async function devPedido(a: any, oid: string) {
  const ord = await mlGet(a, `/orders/${oid}`).catch(nao429); await espera(250);
  const sid = ord?.shipping?.id; const shp = sid ? await mlGet(a, `/shipments/${sid}`).catch(nao429) : null; if (sid) await espera(250);
  const it = ord?.order_items?.[0]; const ev: any[] = [];
  const add = (d: any, t: string, x = "") => { if (d) ev.push({ d: isoD(d), t, x: String(x ?? "") }); };
  add(ord?.date_created, "venda", it ? `${it.quantity}|${it.unit_price}` : "");
  const sh = shp?.status_history || {};
  add(sh.date_shipped, "envio_saiu"); add(sh.date_first_visit, "envio_visita"); add(sh.date_delivered, "envio_entregue"); add(sh.date_not_delivered, "envio_nao_entregue");
  add(sh.date_returned, "envio_retornou"); add(sh.date_cancelled, "envio_cancelado");
  add(ord?.cancel_detail?.date, "pedido_cancelado", ord?.cancel_detail?.code || "");
  // logística da venda: fulfillment = saiu do Full; node "BRP<vendedor>" = estoque próprio
  const node = it?.stock?.node_id || ""; const logistica = shp?.logistic_type || (node ? (/^BRP\d/.test(node) ? "proprio" : "fulfillment") : null);
  return { ord, it, ev, envio: shp?.status || null, logistica };
}
async function devClaim(a: any, c: any) {
  const oid = String(c.resource_id);
  const hist = await mlGet(a, `/post-purchase/v1/claims/${c.id}/status_history`).catch(nao429); await espera(250);
  const ret = await mlGet(a, `/post-purchase/v2/claims/${c.id}/returns`).catch(nao429); await espera(250);
  const p = await devPedido(a, oid);
  const rs = (ret?.shipments || []).find((x: any) => x.type === "return") || ret?.shipments?.[0];
  const rsh = rs?.shipment_id ? await mlGet(a, `/shipments/${rs.shipment_id}`).catch(nao429) : null; if (rs?.shipment_id) await espera(250);
  let review: any = null;
  if (ret?.id && (ret.related_entities || []).includes("reviews")) { review = await mlGet(a, `/post-purchase/v1/returns/${ret.id}/reviews`).catch(nao429); await espera(250); }
  const destino = rs?.destination?.name || null;
  const ev = p.ev; const add = (d: any, t: string, x = "") => { if (d) ev.push({ d: isoD(d), t, x: String(x ?? "") }); };
  for (const h of Array.isArray(hist) ? hist : []) add(h.date, h.stage === "dispute" ? "mediacao" : "reclamacao", `${h.status}|${h.change_by || ""}`);
  if (ret) add(ret.date_created, "retorno_criado", destino || "");
  const rh = rsh?.status_history || {};
  add(rh.date_shipped, "retorno_enviado", destino || ""); add(rh.date_delivered, "retorno_entregue", destino || ""); add(rh.date_not_delivered, "retorno_nao_entregue"); add(rh.date_cancelled, "retorno_cancelado");
  const cond = (JSON.stringify(review || {}).match(/"product_condition"\s*:\s*"([^"]+)"/) || [])[1] || null;
  const rdt = (JSON.stringify(review || {}).match(/"date_created"\s*:\s*"([^"]+)"/) || [])[1] || null;
  if (cond) add(rdt || ret?.last_updated, "revisao", cond);
  if (c.resolution?.date_created) add(c.resolution.date_created, "resolucao", `${c.resolution.reason || ""}|${(c.resolution.benefited || []).join(",")}`);
  if (ret?.date_closed) add(ret.date_closed, "retorno_fechado", `${ret.status || ""}|${ret.status_money || ""}`);
  const qtd = +(ret?.orders?.[0]?.return_quantity ?? c.claimed_quantity ?? p.it?.quantity ?? 1) || 1;
  return { order_id: oid, claim_id: String(c.id), origem: "claim", claim_status: c.status, resolucao: c.resolution?.reason || null, beneficiado: (c.resolution?.benefited || []).join(",") || null,
    ret_id: ret?.id ? String(ret.id) : null, ret_status: ret?.status || null, destino, status_money: ret?.status_money || null, ship_status: rsh?.status || rs?.status || null,
    venda_em: isoD(p.ord?.date_created), devol_em: isoD(c.date_created), fechado_em: isoD(ret?.date_closed || c.resolution?.date_created),
    item_id: p.it?.item?.id || null, titulo: p.it?.item?.title || null, sku: p.it?.item?.seller_sku || null, qtd, valor: Math.round((+p.it?.unit_price || 0) * qtd * 100) / 100,
    logistica: p.logistica, eventos: ev, review: review ? { condicao: cond, raw: review } : null, raw: { claim: c, ret }, ml_updated: isoD(c.last_updated), updated_at: new Date().toISOString() };
}
async function devSync() {
  const t0 = Date.now(); const a = await mlToken();
  const desde = a.dev_ate ? new Date(new Date(a.dev_ate).getTime() - 60000).toISOString() : new Date(Date.now() - 150 * 86400000).toISOString();
  let n = 0, ultimo = a.dev_ate || null, parcial = false;
  try {
    fora: for (let off = 0; off < 3000; off += 50) {
      const j = await mlGet(a, `/post-purchase/v1/claims/search?player_role=respondent&player_user_id=${a.user_id}&type=returns&range=last_updated:after:${encodeURIComponent(desde)}&sort=last_updated:asc&limit=50&offset=${off}`);
      const cs = j.data || [];
      for (const c of cs) {
        if (Date.now() - t0 > 90000) { parcial = true; break fora; }
        if (c.fulfilled === true) { const row = await devClaim(a, c); await q(db.from("full_ml_devol").upsert(row)); n++; }
        ultimo = c.last_updated;
      }
      if (cs.length < 50) break;
    }
    // entregas não concluídas que voltaram ao Full e não têm reclamação de devolução
    if (!parcial) {
      const ops = await todas((x, y) => db.from("full_ml_ops").select("ref,data,inv,disp").eq("tipo", "sale_delivery_cancelation").gte("data", new Date(Date.now() - 150 * 86400000).toISOString()).order("data").range(x, y));
      const porPed = new Map<string, any>(); for (const o of ops) { const v = o.ref?.[0]?.value; if (v && !porPed.has(String(v))) porPed.set(String(v), o); }
      const ids = [...porPed.keys()];
      const ja = new Set<string>(); for (let i = 0; i < ids.length; i += 200) (await q(db.from("full_ml_devol").select("order_id").in("order_id", ids.slice(i, i + 200)))).forEach((r: any) => ja.add(r.order_id));
      for (const oid of ids.filter((x) => !ja.has(x))) {
        if (Date.now() - t0 > 90000) { parcial = true; break; }
        const op = porPed.get(oid); const p = await devPedido(a, oid);
        const qtd = Math.max(1, +op.disp || 1);
        await q(db.from("full_ml_devol").upsert({ order_id: oid, claim_id: null, origem: "nao_entregue", claim_status: null, resolucao: null, beneficiado: null, ret_id: null, ret_status: "nao_entregue",
          destino: "warehouse", status_money: null, ship_status: p.envio, venda_em: isoD(p.ord?.date_created), devol_em: isoD(op.data), fechado_em: isoD(op.data),
          item_id: p.it?.item?.id || null, titulo: p.it?.item?.title || null, sku: p.it?.item?.seller_sku || null, qtd, valor: Math.round((+p.it?.unit_price || 0) * qtd * 100) / 100,
          logistica: p.logistica || "fulfillment", eventos: p.ev, review: null, raw: { op, pedido: !!p.ord }, ml_updated: isoD(op.data), updated_at: new Date().toISOString() }));
        n++;
      }
    }
    // devoluções gravadas antes de guardar a logística: classifica se a venda saiu do Full
    if (!parcial) {
      const sem = await q(db.from("full_ml_devol").select("order_id").is("logistica", null).limit(60));
      for (const r of sem) {
        if (Date.now() - t0 > 90000) { parcial = true; break; }
        const ord = await mlGet(a, `/orders/${r.order_id}`).catch(nao429); await espera(250);
        const sid = ord?.shipping?.id; const shp = sid ? await mlGet(a, `/shipments/${sid}`).catch(nao429) : null; if (sid) await espera(250);
        const node = ord?.order_items?.[0]?.stock?.node_id || "";
        const lg = shp?.logistic_type || (node ? (/^BRP\d/.test(node) ? "proprio" : "fulfillment") : "desconhecida");
        await q(db.from("full_ml_devol").update({ logistica: lg }).eq("order_id", r.order_id)); n++;
      }
    }
  } catch (e) {
    if (e instanceof Erro && e.s === 429) parcial = true; else { await db.from("full_ml_auth").update({ dev_ate: ultimo, dev_msg: e instanceof Error ? e.message : String(e) }).eq("id", 1); throw e; }
  }
  await q(db.from("full_ml_auth").update({ dev_ate: ultimo, dev_sync: new Date().toISOString(), dev_msg: null }).eq("id", 1));
  return { devolucoes: n, parcial };
}

async function rev() {
  // inclui o Picking: cadastrar EAN ou local lá atualiza as telas daqui em poucos segundos
  const [a, b, c, d] = await Promise.all([
    q(db.from("full_envios").select("updated_at").order("updated_at", { ascending: false }).limit(1)),
    q(db.from("full_vinc").select("updated_at").order("updated_at", { ascending: false }).limit(1)),
    db.from("full_envios").select("id", { count: "exact", head: true }),
    q(db.from("products").select("updated_at").order("updated_at", { ascending: false, nullsFirst: false }).limit(1)),
  ]);
  const count = c.count;
  return `${a[0]?.updated_at || ""}|${b[0]?.updated_at || ""}|${count ?? ""}|${d[0]?.updated_at || ""}`;
}

async function estado(me: Me, since?: string) {
  const r = await rev();
  if (since && since === r) return { rev: r, same: true };
  let sel = db.from("full_envios").select("id,criado,status,pvs,anuncios,pre,manual,motivo,updated_at").order("criado", { ascending: false }).limit(400);
  if (me.qrEnvio) sel = sel.eq("id", me.qrEnvio);
  else if (me.role !== "gestor") sel = sel.in("status", ["liberado", "concluido"]);
  const envios = await q(sel);
  const ids = envios.map((e: { id: string }) => e.id);
  const ativos = envios.filter((e: { status: string }) => e.status !== "concluido").map((e: { id: string }) => e.id);
  // celular (QR): só o que a tela de separação usa, em paralelo
  if (me.qrEnvio) {
    const invs = [...new Set(envios.flatMap((e: any) => (e.anuncios || []).map((a: any) => a.inv)))];
    const [sep, vinc, blocks, users] = await Promise.all([
      ids.length ? q(db.from("full_sep").select("envio,cod,status,resp,n,lab").in("envio", ids)) : [],
      invs.length ? q(db.from("full_vinc").select("inv,cod,mult").in("inv", invs)) : [],
      q(db.from("blocks").select("id,data")),
      q(db.from("full_users").select("login,nome,role,ativo,modo").eq("ativo", true)),
    ]);
    const cods = [...new Set(vinc.map((v: any) => v.cod).filter(Boolean))];
    const [erp, prods] = cods.length ? await Promise.all([
      q(db.from("full_erp").select("cod,nome,ean").in("cod", cods)),
      q(db.from("products").select("id,data").in("id", cods)),
    ]) : [[], []];
    return {
      rev: r, me, envios, sep, logs: [], vinc, erp,
      locs: Object.fromEntries(prods.map((p: any) => [p.id, p.data?.loc || ""])),
      eans: Object.fromEntries(prods.map((p: any) => [p.id, String(p.data?.ean || "").trim()])),
      blocks: Object.fromEntries(blocks.map((b: any) => [b.id, b.data])),
      users,
    };
  }
  const [sep, logs, vinc, erp, blocks, users] = await Promise.all([
    ids.length ? q(db.from("full_sep").select("envio,cod,status,resp,n,lab").in("envio", ids)) : [],
    ativos.length ? q(db.from("full_log").select("envio,at,msg").in("envio", ativos).order("at", { ascending: false }).limit(300)) : [],
    q(db.from("full_vinc").select("inv,cod,mult")),
    q(db.from("full_erp").select("cod,nome,ean")),
    q(db.from("blocks").select("id,data")),
    q(db.from("full_users").select("login,nome,role,ativo,modo").order("nome")),
  ]);
  const cods = erp.map((p: { cod: string }) => p.cod);
  const prods = cods.length ? await q(db.from("products").select("id,data").in("id", cods)) : [];
  return {
    rev: r, me,
    envios, sep, logs, vinc, erp,
    locs: Object.fromEntries(prods.map((p: { id: string; data: { loc?: string } }) => [p.id, p.data?.loc || ""])),
    eans: Object.fromEntries(prods.map((p: any) => [p.id, String(p.data?.ean || "").trim()])),
    blocks: Object.fromEntries(blocks.map((b: { id: string; data: unknown }) => [b.id, b.data])),
    users: users.filter((u: { ativo: boolean }) => me.role === "gestor" || u.ativo),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    const op = String(b.op || "");

    if (op === "login") {
      const tok = await q(db.rpc("full_login", { p_login: String(b.login || ""), p_pin: String(b.pin || "") }));
      if (!tok) throw new Erro("Usuário ou PIN incorreto.", 401);
      const s = await q(db.from("full_sessions").select("login").eq("token", tok).single());
      const u = await q(db.from("full_users").select("login,nome,role").eq("login", s.login).single());
      return out({ token: tok, me: u });
    }

    const me = await quem(req);
    if (!me) throw new Erro(req.headers.get("x-full-qr") ? "Link inválido ou expirado." : "Sessão expirada. Entre de novo.", 401);
    const gestor = me.role === "gestor";
    const doEnvio = (id: string) => { must(!me.qrEnvio || me.qrEnvio === id, "Este link não é deste envio."); };
    if (me.role === "sistema") must(op === "ml_sync" || op === "dev_sync", "Operação não permitida.");

    switch (op) {
      case "logout": await db.from("full_sessions").delete().eq("token", req.headers.get("x-full-token") || ""); return out({ ok: true });
      case "state": return out(await estado(me, b.since));

      case "importar": {
        must(gestor && !me.qrEnvio, "Só o gestor importa envios.");
        const e = b.envio; must(e && /^[\w-]{3,40}$/.test(e.id) && Array.isArray(e.anuncios) && e.anuncios.length, "Envio inválido.", 400);
        const erp = Object.entries(b.erp || {}).map(([cod, p]: [string, any]) => ({ cod, nome: String(p.nome || cod), ean: String(p.ean || "") }));
        if (erp.length) await q(db.from("full_erp").upsert(erp));
        const ex = await q(db.from("full_vinc").select("inv,cod"));
        const temCod = new Set(ex.filter((v: { cod: string }) => v.cod).map((v: { inv: string }) => v.inv));
        const novos = Object.entries(b.vinc || {}).filter(([inv]) => !temCod.has(inv)).map(([inv, v]: [string, any]) => ({ inv, cod: String(v.cod || ""), mult: Math.max(1, +v.mult || 1), updated_at: new Date().toISOString() }));
        if (novos.length) await q(db.from("full_vinc").upsert(novos));
        await q(db.from("full_envios").delete().eq("id", e.id));
        await q(db.from("full_envios").insert({ id: e.id, status: "rascunho", pvs: e.pvs || [], anuncios: e.anuncios, pre: e.pre || {} }));
        await log(e.id, `${me.nome} importou o envio`);
        return out({ ok: true });
      }
      case "prod": {
        must(gestor && !me.qrEnvio, "Só o gestor busca produtos.");
        const t = String(b.q || "").trim().replace(/[%,()]/g, "");
        if (t.length < 2) return out({ itens: [] });
        const a1 = await q(db.from("products").select("id,data").ilike("id", `${t}%`).limit(8));
        const a2 = await q(db.from("products").select("id,data").ilike("data->>name", `%${t.replace(/\s+/g, "%")}%`).limit(8));
        const m = new Map();
        [...a1, ...a2].forEach((p: any) => m.set(p.id, { cod: p.id, nome: p.data?.name || p.id, ean: p.data?.ean || "" }));
        return out({ itens: [...m.values()].slice(0, 8) });
      }
      case "vinc": {
        must(gestor && !me.qrEnvio, "Só o gestor altera vínculos.");
        if (b.cod) {
          const ja = await q(db.from("full_erp").select("cod").eq("cod", String(b.cod)).maybeSingle());
          if (!ja) { const p = await q(db.from("products").select("id,data").eq("id", String(b.cod)).maybeSingle());
            await q(db.from("full_erp").upsert({ cod: String(b.cod), nome: p?.data?.name || String(b.cod), ean: p?.data?.ean || "" })); }
        }
        await q(db.from("full_vinc").upsert({ inv: String(b.inv), cod: String(b.cod || ""), mult: Math.max(1, +b.mult || 1), updated_at: new Date().toISOString() }));
        return out({ ok: true });
      }
      case "atualizar": {
        must(gestor && !me.qrEnvio, "Só o gestor atualiza envios.");
        const e = await q(db.from("full_envios").select("status").eq("id", b.id).maybeSingle());
        must(e, "Envio não encontrado.", 404); must(e.status !== "concluido", "Envio já concluído.", 400);
        const upd: Record<string, unknown> = { updated_at: new Date().toISOString() }; const oq: string[] = [];
        if (Array.isArray(b.anuncios)) {
          must(b.anuncios.length > 0, "Nenhuma etiqueta nos arquivos.", 400);
          upd.anuncios = b.anuncios; oq.push(`etiquetas (${b.anuncios.length} anúncios)`);
          const ex = await q(db.from("full_vinc").select("inv,cod"));
          const temCod = new Set(ex.filter((v: { cod: string }) => v.cod).map((v: { inv: string }) => v.inv));
          const novos = Object.entries(b.vinc || {}).filter(([inv]) => !temCod.has(inv)).map(([inv, v]: [string, any]) => ({ inv, cod: String(v.cod || ""), mult: Math.max(1, +v.mult || 1), updated_at: new Date().toISOString() }));
          if (novos.length) await q(db.from("full_vinc").upsert(novos));
        }
        if (b.pre && typeof b.pre === "object") {
          upd.pre = b.pre; upd.pvs = Array.isArray(b.pvs) ? b.pvs : []; oq.push(`pré-venda (${(upd.pvs as string[]).join(", ")})`);
          const erp = Object.entries(b.erp || {}).map(([cod, p]: [string, any]) => ({ cod, nome: String(p.nome || cod), ean: String(p.ean || "") }));
          if (erp.length) await q(db.from("full_erp").upsert(erp));
        }
        must(oq.length, "Nada para atualizar.", 400);
        await q(db.from("full_envios").update(upd).eq("id", b.id));
        await log(b.id, `${me.nome} atualizou ${oq.join(" e ")}`);
        return out({ ok: true });
      }
      case "modo": {
        must(["camera", "bluetooth", "coletor"].includes(b.modo), "Modo de bipagem inválido.", 400);
        const alvo = gestor && !me.qrEnvio && b.login ? String(b.login) : me.login;
        await q(db.from("full_users").update({ modo: b.modo }).eq("login", alvo));
        return out({ ok: true });
      }
      case "ml_status": {
        must(gestor, "Só o gestor vê o estoque do Full.");
        const a = await mlAuth();
        return out({ conectado: mlLigado(a), offline: !!a?.refresh_token, nick: a?.nick || "", ultima_sync: a?.ultima_sync || null, msg: a?.msg || null, client_id: ML_ID, redirect: ML_REDIR });
      }
      case "ml_callback": {
        must(gestor && !me.qrEnvio, "Só o gestor conecta o Mercado Livre.");
        must(b.code, "Código de autorização ausente.", 400);
        const t = await mlOauth({ grant_type: "authorization_code", code: String(b.code), redirect_uri: ML_REDIR });
        const u = await (await fetch(`${ML}/users/me`, { headers: { authorization: `Bearer ${t.access_token}` } })).json().catch(() => ({}));
        await q(db.from("full_ml_auth").update({ user_id: t.user_id || u.id, nick: u.nickname || "", access_token: t.access_token, refresh_token: t.refresh_token, expira: t.expira, msg: null, updated_at: new Date().toISOString() }).eq("id", 1));
        const r = await mlSync(); return out({ ok: true, ...r });
      }
      case "ml_sync": {
        must(gestor || me.role === "sistema", "Só o gestor sincroniza.");
        if (me.role === "sistema") { const a = await mlAuth(); if (!mlLigado(a)) return out({ ok: true, pulado: true }); if (a?.ultima_sync && Date.now() - new Date(a.ultima_sync).getTime() < 90000) return out({ ok: true, pulado: true }); }
        const r = await mlSync(Math.max(0, +b.dias || 0)); return out({ ok: true, ...r });
      }
      case "dev_sync": {
        must(gestor || me.role === "sistema", "Só o gestor sincroniza.");
        if (me.role === "sistema") { const a = await mlAuth(); if (!mlLigado(a)) return out({ ok: true, pulado: true }); }
        return out({ ok: true, ...(await devSync()) });
      }
      case "dev_painel": {
        must(gestor && !me.qrEnvio, "Só o gestor vê as devoluções.");
        const dias = Math.min(365, Math.max(1, +b.dias || 30));
        const desde = new Date(Date.now() - dias * 86400000).toISOString();
        const [a, rows, est, res] = await Promise.all([
          mlAuth(), todas((x, y) => db.from("full_ml_devol").select("order_id,claim_id,origem,claim_status,resolucao,beneficiado,ret_status,destino,status_money,ship_status,venda_em,devol_em,fechado_em,item_id,titulo,sku,qtd,valor,logistica,eventos,review->condicao").gte("devol_em", desde).order("devol_em", { ascending: false }).range(x, y)),
          todas((x, y) => db.from("full_ml_estoque").select("inv,item_id,titulo,sku,total,disponivel,indisponivel,detalhe").gt("indisponivel", 0).order("inv").range(x, y)),
          q(db.rpc("full_ml_resumo_json", { p_desde: desde })),
        ]);
        const ids = rows.map((r: any) => r.order_id); const ops: any[] = [];
        for (let i = 0; i < ids.length; i += 150) ops.push(...await q(db.from("full_ml_ops").select("data,tipo,disp,indisp,inv,ref->0->>value").in("tipo", ["sale_return", "sale_delivery_cancelation", "quarantine_reservation", "quarantine_restock"]).in("ref->0->>value", ids.slice(i, i + 150))));
        const vendidas = (res || []).filter((x: any) => x.tipo === "sale_confirmation").reduce((t: number, x: any) => t + Math.abs(+x.disp || 0), 0);
        return out({ dias, conectado: mlLigado(a), dev_sync: a?.dev_sync || null, dev_msg: a?.dev_msg || null, devolucoes: rows, ops, indisp: est, vendidas });
      }
      case "ml_desconectar": {
        must(gestor && !me.qrEnvio, "Só o gestor desconecta.");
        await q(db.from("full_ml_auth").update({ access_token: null, refresh_token: null, expira: null, msg: null }).eq("id", 1)); return out({ ok: true });
      }
      case "ml_painel": {
        must(gestor && !me.qrEnvio, "Só o gestor vê o estoque do Full.");
        const dias = Math.min(365, Math.max(1, +b.dias || 30));
        const desde = new Date(Date.now() - dias * 86400000).toISOString();
        const [a, est, res, cus, devV, vds] = await Promise.all([
          mlAuth(), todas((x, y) => db.from("full_ml_estoque").select("inv,item_id,titulo,sku,status,total,disponivel,indisponivel,detalhe,updated_at").order("inv").range(x, y)),
          q(db.rpc("full_ml_resumo_json", { p_desde: desde })), todas((x, y) => db.from("full_custo").select("cod,custo,updated_at").order("cod").range(x, y)),
          q(db.rpc("full_ml_devol_vendas", { p_desde: desde })),
          q(db.rpc("full_ml_vendas_json", { p_desde: desde, p_base: new Date(Date.now() - 180 * 86400000).toISOString() })),
        ]);
        const cu = a?.ops_cursor; const carga = cu ? new Date(new Date(cu.fim).getTime() - (cu.w || 0) * 30 * 86400000).toISOString() : null;
        return out({ carga, conectado: mlLigado(a), offline: !!a?.refresh_token, expira: a?.expira || null, nick: a?.nick || "", ultima_sync: a?.ultima_sync || null, msg: a?.msg || null, client_id: ML_ID, redirect: ML_REDIR,
          dias, estoque: est, resumo: res, devVendas: devV, vendas: vds, custos: cus, custos_em: cus.reduce((m: string, c: any) => (c.updated_at > m ? c.updated_at : m), "") });
      }
      case "ml_hist": {
        must(gestor && !me.qrEnvio, "Só o gestor vê o histórico.");
        return out({ ops: await q(db.from("full_ml_ops").select("id::text,data,tipo,disp,indisp,saldo,ref").eq("inv", String(b.inv)).order("data", { ascending: false }).limit(500)) });
      }
      case "custos": {
        must(gestor && !me.qrEnvio, "Só o gestor importa custos.");
        const it = (Array.isArray(b.itens) ? b.itens : []).map((x: any) => ({ cod: String(x.cod || "").trim(), descricao: String(x.descricao || "").slice(0, 200), custo: Math.round((+x.custo || 0) * 100) / 100, updated_at: new Date().toISOString() }))
          .filter((x: any) => x.cod && x.custo >= 0);
        must(it.length, "Nenhum custo válido na planilha.", 400);
        for (let i = 0; i < it.length; i += 500) await q(db.from("full_custo").upsert(it.slice(i, i + 500)));
        return out({ ok: true, n: it.length });
      }
      case "liberar": {
        must(gestor && !me.qrEnvio, "Só o gestor libera envios.");
        await q(db.from("full_envios").update({ status: "liberado", updated_at: new Date().toISOString() }).eq("id", b.id));
        await log(b.id, `${me.nome} liberou para a expedição`); return out({ ok: true });
      }
      case "excluir": {
        must(gestor && !me.qrEnvio, "Só o gestor exclui envios.");
        const e = await q(db.from("full_envios").select("status").eq("id", b.id).maybeSingle());
        must(e, "Envio não encontrado.", 404);
        await q(db.from("full_envios").delete().eq("id", b.id)); return out({ ok: true });
      }
      case "addpre": case "rmpre": {
        must(gestor && !me.qrEnvio, "Só o gestor altera a pré-venda.");
        const e = await q(db.from("full_envios").select("manual").eq("id", b.id).single());
        const m = e.manual || {};
        if (op === "addpre") m[b.cod] = { qtd: (m[b.cod]?.qtd || 0) + Math.max(1, +b.qtd || 0), por: me.login, em: new Date().toISOString() }; else delete m[b.cod];
        await q(db.from("full_envios").update({ manual: m, updated_at: new Date().toISOString() }).eq("id", b.id));
        await log(b.id, op === "addpre" ? `${me.nome} adicionou ${b.qtd} × ${b.cod} à pré-venda` : `${me.nome} removeu o item manual ${b.cod}`);
        return out({ ok: true });
      }
      case "concluir": {
        doEnvio(b.id); must(!me.qrEnvio, "Conclua o envio pelo computador.");
        const upd: Record<string, unknown> = { status: "concluido", updated_at: new Date().toISOString() };
        let txt = `${me.nome} concluiu o envio`;
        if (b.parcial) {
          must(gestor, "Só o gestor conclui um envio com itens faltantes.");
          const obs = String(b.obs || "").trim().slice(0, 300); must(obs, "Escreva o motivo para concluir com itens faltantes.", 400);
          const fs = (Array.isArray(b.faltas) ? b.faltas : []).slice(0, 200).map((f: any) => `${String(f.cod)} (${+f.lab || 0}/${+f.etq || 0} etiquetas)`);
          const ant = await q(db.from("full_envios").select("motivo").eq("id", b.id).maybeSingle());
          upd.motivo = [ant?.motivo, `Concluído com ${fs.length} item(ns) faltante(s): ${fs.join(", ")}. Motivo: ${obs}`].filter(Boolean).join(" | ").slice(0, 2000);
          txt = `${me.nome} concluiu o envio com ${fs.length} item(ns) faltante(s) — ${obs}`;
        }
        await q(db.from("full_envios").update(upd).eq("id", b.id).eq("status", "liberado"));
        await q(db.from("full_qr").update({ revogado: true }).eq("envio", b.id));
        await log(b.id, txt); return out({ ok: true });
      }
      case "sep": {
        doEnvio(b.envio);
        const acao = String(b.acao);
        must(!me.qrEnvio || ["pega", "n", "tudo", "done", "solta"].includes(acao), "Ação não permitida pelo celular.");
        const r = await q(db.rpc("full_sep_op", { p_envio: b.envio, p_cod: String(b.cod), p_login: me.login, p_acao: acao, p_inv: b.inv ?? null, p_max: b.max ?? null, p_total: b.total ?? null, p_final: !!b.final }));
        if (!r.erro && b.msg) await log(b.envio, `${me.nome} ${b.msg}`);
        return out(r);
      }
      case "log": { doEnvio(b.envio); await log(b.envio, `${me.nome} ${b.msg}`); await toque(b.envio); return out({ ok: true }); }
      case "qr": {
        must(!me.qrEnvio, "Gere o QR pelo computador.");
        const u = await q(db.from("full_users").select("login,ativo").eq("login", String(b.login)).maybeSingle());
        must(u && u.ativo, "Usuário inválido.", 400);
        if (b.novo) await q(db.from("full_qr").update({ revogado: true }).eq("envio", b.envio).eq("login", u.login));
        const ex = b.novo ? [] : await q(db.from("full_qr").select("token").eq("envio", b.envio).eq("login", u.login).eq("revogado", false).limit(1));
        let token = ex[0]?.token;
        if (!token) { token = rnd(18); await q(db.from("full_qr").insert({ token, envio: b.envio, login: u.login })); }
        return out({ token });
      }
      case "user": {
        must(gestor && !me.qrEnvio, "Só o gestor gerencia usuários.");
        const login = String(b.login || "").trim().toLowerCase();
        must(/^[a-z0-9._-]{2,30}$/.test(login), "Login inválido: use letras minúsculas, números, ponto ou traço.", 400);
        must(["gestor", "expedicao"].includes(b.role), "Perfil inválido.", 400);
        const ex = await q(db.from("full_users").select("login").eq("login", login).maybeSingle());
        if (b.pin !== undefined && b.pin !== "") must(/^\d{4}$/.test(String(b.pin)), "O PIN precisa ter 4 números.", 400);
        if (!ex) {
          must(/^\d{4}$/.test(String(b.pin || "")), "Informe um PIN de 4 números.", 400);
          await q(db.from("full_users").insert({ login, nome: String(b.nome || login).slice(0, 60), role: b.role, pin_hash: "x", ativo: b.ativo !== false, modo: ["camera", "bluetooth", "coletor"].includes(b.modo) ? b.modo : "camera" }));
        } else {
          must(!(login === me.login && (b.ativo === false || b.role !== "gestor")), "Você não pode desativar ou rebaixar o seu próprio usuário.", 400);
          await q(db.from("full_users").update({ nome: String(b.nome || login).slice(0, 60), role: b.role, ativo: b.ativo !== false, ...(["camera", "bluetooth", "coletor"].includes(b.modo) ? { modo: b.modo } : {}) }).eq("login", login));
          if (b.ativo === false) await q(db.from("full_sessions").delete().eq("login", login));
        }
        if (b.pin) await q(db.rpc("full_set_pin", { p_login: login, p_pin: String(b.pin) }));
        return out({ ok: true });
      }
      default: throw new Erro("Operação desconhecida.", 400);
    }
  } catch (e) {
    const s = e instanceof Erro ? e.s : 500;
    return out({ erro: e instanceof Error ? e.message : String(e) }, s);
  }
});
