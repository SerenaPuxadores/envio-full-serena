/* ===== GESTOR · DEVOLUÇÕES (Mercado Livre · vendas Full) ===== */
let DV_CARREGANDO=false;
async function dvCarregar(){ if(DV_CARREGANDO) return; DV_CARREGANDO=true; DB.dvErro=null;
  try{ DB.dv=await api("dev_painel",{dias:DB.dvDias||30}); }catch(x){ DB.dvErro=x.message; }
  DV_CARREGANDO=false; if(DB.tab==="devolucoes") render(); }
async function dvSincronizar(){ if(DB.dvSync) return; DB.dvSync=true; render();
  try{ const r=await api("dev_sync",{}); toast(r.parcial?`Sincronizando… ${n0(r.devolucoes)} atualizadas, o resto continua sozinho`:`Devoluções sincronizadas · ${n0(r.devolucoes)}`); }catch(x){ toast(x.message); }
  DB.dvSync=false; await dvCarregar(); }

const DV_CAT={full:["Voltou ao Full","dv-full"],loja:["Voltou para nosso estoque","dv-loja"],nao:["Entrega não concluída","dv-nao"],sem:["Sem retorno do produto","dv-sem"],and:["Em andamento","dv-and"]};
const DV_RET={pending:"Aguardando o comprador enviar",label_generated:"Etiqueta de devolução gerada",shipped:"Devolução a caminho",delivered:"Devolução entregue",not_delivered:"Devolução não entregue",
  closed:"Encerrada",cancelled:"Cancelada",expired:"Expirada (comprador não enviou)",failed:"Falhou",nao_entregue:"Entrega não concluída"};
const DV_RES={warehouse_decision:"Decisão do Full após revisar o produto",return_expired:"Comprador não enviou o produto",item_returned:"Produto devolvido",payment_refunded:"Dinheiro devolvido ao comprador",
  already_shipped:"Produto já enviado",timeout:"Prazo esgotado",partial_refunded:"Reembolso parcial",low_cost:"Reembolso sem devolução (baixo custo)",worked_out_with_seller:"Resolvido com o vendedor",
  respondent_timeout:"Prazo do vendedor esgotado",coverage_decision:"Coberto pelo Mercado Livre",prepaid_refund:"Reembolso antecipado",warehouse_timeout:"Demora na revisão do Full",
  return_canceled:"Devolução cancelada",opened_claim_by_mistake:"Aberta por engano",product_delivered:"Produto entregue ao comprador",found_missing_parts:"Peças encontradas",item_changed:"Produto trocado",
  reimbursed:"Reembolsado",not_delivered:"Não entregue",refund:"Reembolso"};
const DV_COND={saleable:"vendável (voltou ao estoque)",unsaleable:"não vendável",discard:"descartado",damaged:"avariado",missing:"faltando peças",different:"produto diferente",not_received:"não recebido"};
const DV_IND={notSupported:["Não aceito pelo Full",true],damaged:["Avariado",true],withdrawal:["Reservado para retirada",true],noFiscalCoverage:["Sem cobertura fiscal",false],lost:["Extraviado",false],
  transfer:["Em transferência",false],internal_process:["Em processo interno",false],quarantine:["Em quarentena",false],inQuarantine:["Em quarentena",false]};
const DV_MONEY={refunded:"Dinheiro devolvido ao comprador",retained:"Dinheiro retido",available:"Dinheiro liberado para você"};
const dvData=d=>d?new Date(d).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit"}):"—";
const dvHora=d=>d?new Date(d).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";

function dvCat(r){
  if(r.origem==="nao_entregue") return "nao";
  if(r.destino==="seller_address") return "loja";
  if(r.destino==="warehouse") return "full";
  if(r.claim_status==="opened") return "and";
  return "sem"; }
function dvSituacao(r){
  if(r.origem==="nao_entregue") return "O comprador não recebeu e o pedido voltou ao Full";
  const p=[]; if(r.ret_status) p.push(DV_RET[r.ret_status]||r.ret_status);
  if(r.claim_status==="opened") p.push("reclamação aberta"); else if(r.resolucao) p.push(DV_RES[r.resolucao]||r.resolucao);
  return p.join(" · ")||"—"; }

/* eventos do pedido: os do Mercado Livre + as movimentações do estoque do Full ligadas ao pedido */
function dvEventos(r){
  const dest=x=>x==="warehouse"?"Full":x==="seller_address"?"nosso estoque":"—";
  const ev=(r.eventos||[]).map(e=>{ const [a,b]=String(e.x||"").split("|"); let t;
    switch(e.t){
      case "venda": t=`Venda realizada${a?` · ${n0(+a)} un × ${BRL(+b)}`:""}`; break;
      case "envio_saiu": t="Pedido saiu do Full para o comprador"; break;
      case "envio_visita": t="Primeira tentativa de entrega"; break;
      case "envio_entregue": t="Pedido entregue ao comprador"; break;
      case "envio_nao_entregue": t="Entrega ao comprador não concluída"; break;
      case "envio_retornou": t="Pedido voltou ao remetente"; break;
      case "envio_cancelado": t="Envio cancelado"; break;
      case "pedido_cancelado": t="Pedido cancelado"+(a==="mediations"?" pela mediação":""); break;
      case "reclamacao": t=a==="opened"?"Comprador abriu a devolução":a==="closed"?"Reclamação encerrada":`Reclamação: ${a}`; break;
      case "mediacao": t=a==="opened"?"Mercado Livre entrou como mediador":a==="closed"?"Mediação encerrada":`Mediação: ${a}`; break;
      case "retorno_criado": t=`Devolução criada · destino ${dest(a)}`; break;
      case "retorno_enviado": t="Comprador postou a devolução"; break;
      case "retorno_entregue": t=`Devolução recebida no ${dest(a)}`; break;
      case "retorno_nao_entregue": t="Devolução não entregue"; break;
      case "retorno_cancelado": t="Envio da devolução cancelado"; break;
      case "revisao": t=`Full revisou o produto: ${DV_COND[a]||a}`; break;
      case "resolucao": t=`Resolução: ${DV_RES[a]||a}${b?` · a favor do ${b.includes("complainant")?"comprador":b.includes("respondent")?"vendedor":b}`:""}`; break;
      case "retorno_fechado": t=`Devolução encerrada${b?` · ${DV_MONEY[b]||b}`:""}`; break;
      default: t=e.t; }
    return {d:e.d,t,src:"ml"}; });
  ((DB.dv||{}).ops||[]).filter(o=>String(o.value)===r.order_id).forEach(o=>{
    const q=Math.abs(o.disp||0)+Math.abs(o.indisp||0);
    ev.push({d:o.data,t:o.tipo==="sale_return"?`Produto reentrou no estoque do Full (${o.disp>0?`+${n0(o.disp)} disponível`:`${n0(q)} indisponível`}) · ${o.inv}`
      :o.tipo==="sale_delivery_cancelation"?`Voltou ao estoque do Full (+${n0(q)}) · ${o.inv}`
      :o.tipo==="quarantine_reservation"?`Produto em quarentena no Full · ${o.inv}`:`Produto saiu da quarentena · ${o.inv}`,src:"full"}); });
  return ev.filter(e=>e.d).sort((a,b)=>Date.parse(a.d)-Date.parse(b.d)); }

function dvGrafico(lst,dias){
  const D=864e5, hoje=new Date(); hoje.setHours(0,0,0,0);
  const passo=dias<=31?1:7, nb=Math.ceil(dias/passo), ini=hoje.getTime()-(nb-1)*passo*D;
  const bins=Array.from({length:nb},(_,i)=>({t:ini+i*passo*D,full:0,loja:0,nao:0,sem:0,and:0}));
  lst.forEach(r=>{ const k=Math.floor((new Date(r.devol_em).setHours(0,0,0,0)-ini)/(passo*D)); if(k>=0&&k<nb) bins[k][dvCat(r)]++; });
  const max=Math.max(1,...bins.map(b=>b.full+b.loja+b.nao+b.sem+b.and));
  const W=900,H=230,L=34,B=28,T=10, bw=(W-L-8)/nb;
  const y=v=>T+(H-T-B)*(1-v/max);
  const ticks=[...new Set([0,Math.round(max/2),max])];
  const ordem=["full","loja","nao","and","sem"];
  const barras=bins.map((b,i)=>{ let acc=0; const x=L+i*bw+bw*.15, w=Math.max(2,bw*.7);
    const seg=ordem.map(k=>{ if(!b[k]) return ""; const y0=y(acc), y1=y(acc+b[k]); acc+=b[k]; return `<rect class="${DV_CAT[k][1]}" x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${(y0-y1).toFixed(1)}"><title>${dvData(b.t)}${passo>1?` a ${dvData(b.t+6*D)}`:""} · ${DV_CAT[k][0]}: ${b[k]}</title></rect>`; }).join("");
    const lbl=(nb<=16||i%Math.ceil(nb/12)===0)?`<text x="${(x+w/2).toFixed(1)}" y="${H-8}" text-anchor="middle">${new Date(b.t).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</text>`:"";
    return seg+lbl; }).join("");
  return `<figure class="dvchart"><figcaption><b>Devoluções por ${passo===1?"dia":"semana"}</b>
    <span class="dvleg">${ordem.filter(k=>bins.some(b=>b[k])).map(k=>`<span><i class="${DV_CAT[k][1]}"></i>${DV_CAT[k][0]}</span>`).join("")}</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de devoluções por ${passo===1?"dia":"semana"} nos últimos ${dias} dias">
    ${ticks.map(v=>`<line x1="${L}" x2="${W-4}" y1="${y(v)}" y2="${y(v)}" class="dvgrid"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end">${v}</text>`).join("")}
    ${barras}</svg></figure>`; }

function gDevol(){
  const hdr=`<div class="hdr"><div><span class="eyebrow">Mercado Livre · Full</span><h1>Devoluções</h1></div>
    <div class="acts">${DB.dv?.dev_sync?`<span class="muted">Atualizado ${dvHora(DB.dv.dev_sync)}</span>`:""}<button class="btn" data-act="dv-sync" ${DB.dvSync?"disabled":""}>${DB.dvSync?"Sincronizando…":"Sincronizar devoluções"}</button></div></div>`;
  if(!DB.dv&&!DB.dvErro){ dvCarregar(); return hdr+`<div class="panel"><p class="muted">Carregando devoluções…</p></div>`; }
  if(DB.dvErro) return hdr+`<div class="note warn"><span>${esc(DB.dvErro)}</span></div>`;
  const c=DB.dv, dias=c.dias;
  if(!c.conectado) return hdr+`<div class="note warn"><span>Conecte o Mercado Livre na aba Estoque Full para ver as devoluções.</span></div>`;
  const orig=DB.dvOrig||"full", ehFull=r=>r.logistica==="fulfillment";
  const semClass=(c.devolucoes||[]).filter(r=>!r.logistica).length;
  const todos=orig==="full"?(c.devolucoes||[]).filter(ehFull):(c.devolucoes||[]);
  const fullDev=(c.devolucoes||[]).filter(ehFull);
  const cnt=k=>todos.filter(r=>dvCat(r)===k);
  const un=l=>l.reduce((t,r)=>t+(+r.qtd||0),0);
  /* taxa: unidades devolvidas de vendas do Full ÷ unidades vendidas pelo Full no período (o mesmo universo dos dois lados) */
  const unDev=un(todos), unFull=un(fullDev), taxa=c.vendidas?unFull/c.vendidas*100:null;
  const reemb=todos.filter(r=>r.status_money==="refunded").reduce((t,r)=>t+(+r.valor||0),0);
  /* peças indisponíveis no Full: as que o Full não vende e podem ser retiradas */
  const ind=[]; (c.indisp||[]).forEach(e=>(e.detalhe||[]).forEach(d=>{ if(d.status==="transfer"||!d.quantity) return; ind.push({...e,st:d.status,q:d.quantity}); }));
  const ret=ind.filter(x=>(DV_IND[x.st]||[0,true])[1]);
  const card=(v,t,s,cls="")=>`<div class="sum ${cls}"><b class="num">${v}</b><span>${t}</span>${s?`<small class="t2">${s}</small>`:""}</div>`;
  const filtro=DB.dvF||"todas", qs=normB(DB.dvQ||"");
  let lst=filtro==="todas"?todos:cnt(filtro);
  if(qs) lst=lst.filter(r=>buscaAprox(qs,[r.order_id,r.titulo,r.sku,r.item_id,dvSituacao(r)].join(" ")));
  const P=pager("dv",lst.length,20), pg=lst.slice(P.ini,P.fim);
  const PER=[[15,"15 dias"],[30,"30 dias"],[60,"60 dias"],[90,"90 dias"],[180,"180 dias"]];
  const linhas=pg.map(r=>{ const k=dvCat(r), aberto=DB.dvOpen===r.order_id;
    const dd=r.venda_em&&r.devol_em?Math.round((Date.parse(r.devol_em)-Date.parse(r.venda_em))/864e5):null;
    return `<tr class="dvrow ${aberto?"on":""}" data-act="dv-open" data-o="${esc(r.order_id)}" tabindex="0" aria-expanded="${aberto}">
      <td class="mono">${esc(r.order_id)}</td>
      <td><div class="dvtit">${esc(r.titulo||"—")}</div>${r.sku?`<span class="t2">SKU ${esc(r.sku)}</span>`:""}</td>
      <td class="num">${dvData(r.venda_em)}</td><td class="num">${dvData(r.devol_em)}${dd!==null?`<div class="t2">${dd} dia${dd===1?"":"s"} depois</div>`:""}</td>
      <td><span class="tag ${DV_CAT[k][1]}">${DV_CAT[k][0]}</span>${orig==="todas"&&r.logistica!=="fulfillment"?`<div class="t2">${r.logistica==="proprio"||r.logistica&&r.logistica!=="desconhecida"?"venda do estoque próprio":"origem não identificada"}</div>`:""}</td>
      <td class="dvsit">${esc(dvSituacao(r))}</td>
      <td class="r num">${n0(+r.qtd)}</td><td class="r num">${BRL(+r.valor)}</td>
      <td class="r"><span class="dvchev" aria-hidden="true">${aberto?"▴":"▾"}</span></td></tr>
      ${aberto?`<tr class="dvdet"><td colspan="9">${dvCard(r)}</td></tr>`:""}`; }).join("");
  return hdr+`
    <div class="sumrow dvk">
      ${card(n0(todos.length),"devoluções",`${n0(unDev)} un · últimos ${dias} dias`)}
      ${card(taxa===null?"—":taxa.toLocaleString("pt-BR",{maximumFractionDigits:1})+"%","taxa de devolução do Full",`${n0(unFull)} devolvidas de ${n0(c.vendidas)} un vendidas pelo Full`)}
      ${card(n0(cnt("full").length),"voltaram ao Full",`${n0(un(cnt("full")))} un`,"dv-k-full")}
      ${card(n0(cnt("loja").length),"voltaram p/ nosso estoque",`${n0(un(cnt("loja")))} un`,"dv-k-loja")}
      ${card(n0(cnt("nao").length),"entregas não concluídas",`${n0(un(cnt("nao")))} un voltaram ao Full`,"dv-k-nao")}
      ${card(BRL(reemb),"reembolsado ao comprador",`${n0(cnt("and").length)} em andamento`)}
    </div>
    ${semClass?`<div class="lmsg">Identificando a origem de ${n0(semClass)} devolução${semClass>1?"ões":""} (Full ou estoque próprio). ${orig==="full"?"Elas aparecem neste filtro assim que forem identificadas.":""}</div>`:""}
    <div class="panel"><div class="fbar"><div class="seg" role="group" aria-label="Origem da venda">${[["full","Vendas do Full"],["todas","Todas as vendas"]].map(([k,t])=>`<button aria-pressed="${orig===k}" data-act="dv-orig" data-o="${k}">${t}</button>`).join("")}</div><div class="seg" role="group" aria-label="Período">${PER.map(([d,t])=>`<button aria-pressed="${dias===d}" data-act="dv-dias" data-d="${d}">${t}</button>`).join("")}</div></div>
      ${todos.length?dvGrafico(todos,dias):`<p class="muted">Nenhuma devolução nos últimos ${dias} dias.${c.dev_sync?"":" Clique em “Sincronizar devoluções” para buscar no Mercado Livre."}</p>`}</div>
    <div class="panel"><div class="phd"><h3>Vendas devolvidas</h3></div>
      <div class="fbar"><div class="busca2"><span aria-hidden="true">${LUPA}</span><input class="inp" id="dvQ" placeholder="Buscar pedido, produto ou SKU" value="${esc(DB.dvQ||"")}" autocomplete="off"></div>
        <div class="seg" role="group" aria-label="Filtrar devoluções">${[["todas","Todas",todos.length],["full","Voltou ao Full",cnt("full").length],["loja","Nosso estoque",cnt("loja").length],["nao","Não entregues",cnt("nao").length],["and","Em andamento",cnt("and").length],["sem","Sem retorno",cnt("sem").length]].filter(([k,,n])=>k==="todas"||n).map(([k,t,n])=>`<button aria-pressed="${filtro===k}" data-act="dv-f" data-f="${k}">${t} <small>${n}</small></button>`).join("")}</div></div>
      <div class="tbox"><table class="t dvt"><thead><tr><th>Pedido</th><th>Produto</th><th>Venda</th><th>Devolução</th><th>Destino</th><th>Situação</th><th class="r">Qtd</th><th class="r">Valor</th><th></th></tr></thead>
      <tbody>${linhas||`<tr><td colspan="9" class="muted">Nenhuma devolução encontrada.</td></tr>`}</tbody></table></div>${P.html}</div>
    <div class="panel"><div class="phd"><h3>Disponível para retirada no Full</h3><span class="muted">${n0(ret.reduce((t,x)=>t+x.q,0))} peças</span></div>
      <p class="hint">Peças que estão no Full mas não podem ser vendidas. As marcadas como “retirar” vocês podem solicitar a retirada no Mercado Livre; as demais são informativas.</p>
      ${ind.length?`<div class="tbox"><table class="t"><thead><tr><th>Anúncio</th><th>Produto</th><th>Motivo</th><th class="r">Qtd</th><th></th></tr></thead><tbody>
      ${ind.sort((a,b)=>((DV_IND[b.st]||[0,1])[1]-(DV_IND[a.st]||[0,1])[1])||b.q-a.q).map(x=>{ const m=DV_IND[x.st]||[x.st,true]; const v=V(x.inv);
        return `<tr><td class="mono">${esc(x.inv)}</td><td>${v.cod?`${esc(v.cod)} · ${esc(nomeCod(v.cod))}`:esc(x.titulo||"")}</td><td>${esc(m[0])}</td><td class="r num">${n0(x.q)}</td><td>${m[1]?`<span class="tag dv-loja">retirar</span>`:""}</td></tr>`; }).join("")}
      </tbody></table></div>`:`<p class="muted">Nenhuma peça indisponível no Full.</p>`}</div>`;
}
function dvCard(r){
  const ev=dvEventos(r);
  const info=[["Pedido",r.order_id],["Reclamação",r.claim_id||"—"],["Destino",r.destino==="warehouse"?"Full":r.destino==="seller_address"?"Nosso estoque":"—"],
    ["Devolução",r.ret_status?(DV_RET[r.ret_status]||r.ret_status):"—"],["Resolução",r.resolucao?(DV_RES[r.resolucao]||r.resolucao):r.claim_status==="opened"?"Em andamento":"—"],
    ["Dinheiro",r.status_money?(DV_MONEY[r.status_money]||r.status_money):"—"],["Revisão do Full",r.condicao?(DV_COND[r.condicao]||r.condicao):"—"]];
  return `<div class="dvcard"><dl class="dvinfo">${info.map(([a,b])=>`<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join("")}</dl>
    <h4>Histórico do pedido</h4>
    ${ev.length?`<ol class="dvtl">${ev.map(e=>`<li class="${e.src}"><time>${dvHora(e.d)}</time><span>${esc(e.t)}</span></li>`).join("")}</ol>`:`<p class="muted">Sem eventos registrados para este pedido.</p>`}</div>`; }
