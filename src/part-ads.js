/* ===== GESTOR · ANÁLISE DE ADS (Mercado Ads · Product Ads) ===== */
let ADS_CARREGANDO=false;
async function adsCarregar(forca=false){ if(ADS_CARREGANDO) return; ADS_CARREGANDO=true; DB.adsErro=null; if(forca){ DB.adsAtualizando=true; render(); }
  try{ DB.ads=await api("ads_painel",{dias:DB.adsDias||30,forca}); if(forca) toast("Anúncios atualizados"); }catch(x){ DB.adsErro=x.message; }
  ADS_CARREGANDO=false; DB.adsAtualizando=false; if(DB.tab==="ads") render(); }

/* receita total = receita com ads (diretas + indiretas) + vendas orgânicas do anúncio */
const adsRT=m=>m.ra+m.ro;
const adsPct=(a,b)=>b>0?a/b*100:null;
const adsFmtP=v=>v===null?"—":v.toLocaleString("pt-BR",{maximumFractionDigits:1})+"%";
const adsDia=d=>d?d.split("-").reverse().slice(0,2).join("/"):"";
function adsLinhas(){
  const c=DB.ads||{}, cm=new Map((c.campanhas||[]).map(x=>[x.id,x]));
  const qs=DB.adsQ||"", camp=DB.adsCamp||"", lgF=DB.adsLg||"todos";
  let l=(c.ads||[]).map(a=>{ const m=a.m, rt=adsRT(m), cp=cm.get(a.c)||null;
    return {...a,cp,rt,acos:adsPct(m.inv,m.ra),tacos:adsPct(m.inv,rt),roas:m.inv>0?m.ra/m.inv:null}; });
  if(camp) l=l.filter(a=>a.c===camp);
  if(DB.adsSemVenda) l=l.filter(a=>a.m.inv>0&&a.m.ra===0);
  if(lgF==="full") l=l.filter(a=>a.lg==="fulfillment"); else if(lgF==="prop") l=l.filter(a=>a.lg!=="fulfillment");
  if(qs) l=l.filter(a=>buscaAprox(qs,[a.id,a.t,a.cp?.nome||""].join(" ")));
  const ord=DB.adsOrd||"inv", dir=DB.adsDir||-1;
  const val=a=>ord==="inv"?a.m.inv:ord==="ra"?a.m.ra:ord==="rt"?a.rt:ord==="acos"?(a.acos??Infinity):ord==="tacos"?(a.tacos??Infinity):ord==="cli"?a.m.cli:ord==="ua"?a.m.ua:a.m.inv;
  l.sort((a,b)=>(val(a)-val(b))*dir||b.m.inv-a.m.inv);
  return l; }
async function adsBaixar(){
  try{ await xlsxPronto(); const c=DB.ads||{}, l=adsLinhas();
    if(!l.length){ toast("Nada para baixar"); return; }
    /* mesmas colunas da tela, com o MLB à parte; valores numéricos com formato de moeda e de porcentagem */
    const pc=v=>v===null?"":v/100, S=k=>l.reduce((t,a)=>t+a.m[k],0), inv=S("inv"), ra=S("ra"), rt=l.reduce((t,a)=>t+a.rt,0);
    const cab=["MLB","Anúncio","Investido","Receita ads","Receita total","ACOS","TACOS","Cliques"];
    const linhas=l.map(a=>[a.id,a.t||"",a.m.inv,a.m.ra,a.rt,a.m.ra>0?pc(a.acos):"",pc(a.tacos),a.m.cli]);
    linhas.push(["Total da lista",`${l.length} anúncios`,inv,ra,rt,pc(adsPct(inv,ra)),pc(adsPct(inv,rt)),S("cli")]);
    const ws=XLSX.utils.aoa_to_sheet([cab,...linhas]);
    const fmt={2:'"R$" #,##0.00',3:'"R$" #,##0.00',4:'"R$" #,##0.00',5:"0.0%",6:"0.0%",7:"#,##0"};
    for(let r=1;r<=linhas.length;r++) for(const [col,z] of Object.entries(fmt)){ const cel=ws[XLSX.utils.encode_cell({r,c:+col})]; if(cel&&cel.t==="n") cel.z=z; }
    ws["!cols"]=[{wch:16},{wch:Math.min(70,Math.max(10,...l.slice(0,300).map(a=>(a.t||"").length))+2)},{wch:14},{wch:15},{wch:15},{wch:9},{wch:9},{wch:10}];
    ws["!autofilter"]={ref:`A1:H${linhas.length}`};
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Anúncios");
    XLSX.writeFile(wb,`ads-${c.de}-a-${c.ate}.xlsx`); toast(`Planilha baixada · ${n0(l.length)} anúncios`);
  }catch(x){ toast(x.message); } }

function gAds(){
  const busy=DB.adsAtualizando;
  const hdr=`<div class="hdr"><div><span class="eyebrow">Mercado Livre · Mercado Ads</span><h1>Análise de Ads</h1></div>
    <div class="acts">${DB.ads?.em?`<span class="muted">Atualizado ${dvHora(DB.ads.em)}</span>`:""}<button class="btn" data-act="ads-sync" ${busy?"disabled":""}>${busy?"Atualizando…":"Atualizar do Mercado Livre"}</button></div></div>`;
  if(!DB.ads&&!DB.adsErro){ adsCarregar(); return hdr+`<div class="panel"><p class="muted">Buscando os anúncios no Mercado Ads… a primeira consulta do período leva alguns segundos.</p></div>`; }
  if(DB.adsErro) return hdr+`<div class="note warn"><span>${esc(DB.adsErro)}</span></div>`;
  const c=DB.ads, l=adsLinhas();
  const S=k=>l.reduce((t,a)=>t+a.m[k],0), inv=S("inv"), ra=S("ra"), rt=l.reduce((t,a)=>t+a.rt,0), ua=S("ua");
  const acima=l.filter(a=>a.cp?.alvo!=null&&a.acos!==null&&a.acos>a.cp.alvo).length, semVenda=l.filter(a=>a.m.inv>0&&a.m.ra===0);
  const card=(v,t,s,cls="")=>`<div class="sum ${cls}"><b class="num">${v}</b><span>${t}</span>${s?`<small class="t2">${s}</small>`:""}</div>`;
  const P=pager("ads",l.length,30), pg=l.slice(P.ini,P.fim);
  const ord=DB.adsOrd||"inv", dir=DB.adsDir||-1;
  const th=(k,t,cls="r")=>`<th class="${cls}"><button class="adsort ${ord===k?"on":""}" data-act="ads-ord" data-o="${k}" aria-label="Ordenar por ${t}">${t}${ord===k?(dir<0?" ▾":" ▴"):""}</button></th>`;
  const camps=(c.campanhas||[]).filter(x=>(c.ads||[]).some(a=>a.c===x.id)).sort((a,b)=>a.nome.localeCompare(b.nome));
  const linhas=pg.map(a=>{ const alvo=a.cp?.alvo, ruim=alvo!=null&&a.acos!==null&&a.acos>alvo;
    return `<tr>
      <td><div class="adan">${a.th?`<img src="${esc(a.th.replace(/^http:/,"https:"))}" alt="" loading="lazy" width="40" height="40">`:""}<div>
        <a class="dvtit" href="${esc(a.lk||"#")}" target="_blank" rel="noopener">${esc(a.t||a.id)}</a>
        <div class="t2"><span class="mono">${esc(a.id)}</span>${a.cp?` · ${esc(a.cp.nome)}`:""}${a.lg==="fulfillment"?` · <span class="tag dv-full">Full</span>`:""}${a.st&&a.st!=="active"?` · <span class="tag dv-sem">${a.st==="paused"?"pausado":esc(a.st)}</span>`:""}</div></div></div></td>
      <td class="r num">${BRL(a.m.inv)}</td>
      <td class="r num">${BRL(a.m.ra)}<div class="t2">${n0(a.m.ua)} un</div></td>
      <td class="r num">${BRL(a.rt)}<div class="t2">${n0(a.m.ua+a.m.uo)} un</div></td>
      <td class="r num"><span class="${ruim?"dv-neg":a.acos!==null&&alvo!=null?"ads-ok":""}" ${alvo!=null?`title="ACOS alvo da campanha: ${adsFmtP(alvo)}"`:""}>${a.m.ra>0?adsFmtP(a.acos):a.m.inv>0?`<span class="dv-neg">sem venda</span>`:"—"}</span>${alvo!=null?`<div class="t2">alvo ${adsFmtP(alvo)}</div>`:""}</td>
      <td class="r num"><b>${adsFmtP(a.tacos)}</b></td>
      <td class="r num">${n0(a.m.cli)}<div class="t2">${n0(a.m.imp)} impr.</div></td></tr>`; }).join("");
  return hdr+`
    <div class="sumrow dvk">
      ${card(BRL(inv),"investido em ads",`${n0(l.filter(a=>a.m.inv>0).length)} anúncios · ${adsDia(c.de)} a ${adsDia(c.ate)}`)}
      ${card(BRL(ra),"receita com ads",`${n0(ua)} un · ROAS ${inv>0?(ra/inv).toLocaleString("pt-BR",{maximumFractionDigits:1}):"—"}`)}
      ${card(BRL(rt),"receita total",`${BRL(rt-ra)} orgânica`)}
      ${card(adsFmtP(adsPct(inv,ra)),"ACOS","investido ÷ receita com ads","dv-k-full")}
      ${card(adsFmtP(adsPct(inv,rt)),"TACOS","investido ÷ receita total","dv-k-loja")}
      ${card(n0(acima),"acima do ACOS alvo",`${n0(semVenda.length)} investiram ${BRL(semVenda.reduce((t,a)=>t+a.m.inv,0))} sem vender`,acima?"dv-k-rep":"")}
    </div>
    ${c.completo===false?`<div class="lmsg">O Mercado Livre demorou para responder e a lista pode estar incompleta. Clique em “Atualizar do Mercado Livre” para tentar de novo.</div>`:""}
    <div class="panel"><div class="fbar">
      <div class="seg" role="group" aria-label="Período">${[7,15,30,60,90].map(d=>`<button aria-pressed="${(DB.adsDias||30)===d}" data-act="ads-dias" data-d="${d}">${d} dias</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Logística">${[["todos","Todos"],["full","Full"],["prop","Estoque próprio"]].map(([k,t])=>`<button aria-pressed="${(DB.adsLg||"todos")===k}" data-act="ads-lg" data-o="${k}">${t}</button>`).join("")}</div>
      <select class="inp adsel" id="adsCamp" aria-label="Campanha"><option value="">Todas as campanhas</option>${camps.map(x=>`<option value="${esc(x.id)}" ${DB.adsCamp===x.id?"selected":""}>${esc(x.nome)}${x.st!=="active"?" (pausada)":""}</option>`).join("")}</select>
      <div class="busca2"><span aria-hidden="true">${LUPA}</span><input class="inp" id="adsQ" placeholder="Buscar anúncio ou MLB" value="${esc(DB.adsQ||"")}" autocomplete="off"></div>
      <label class="adsflag"><input type="checkbox" id="adsSemVenda" ${DB.adsSemVenda?"checked":""}> Só sem vendas</label>
      <button class="mlxls" data-act="ads-baixar" title="Baixar planilha" aria-label="Baixar planilha da lista">${ICO_XLS}</button>
    </div>
    <details class="adsdef"><summary>Como os valores são calculados</summary><ul>
      <li><b>Investido</b>: custo dos cliques no Mercado Ads no período.</li>
      <li><b>Receita com ads</b>: vendas atribuídas ao anúncio pelo Mercado Ads, diretas (o comprador levou este anúncio) e indiretas (clicou neste e comprou outro seu).</li>
      <li><b>Receita total</b>: receita com ads + vendas orgânicas do anúncio (sem clique em publicidade).</li>
      <li><b>ACOS</b> = investido ÷ receita com ads. É o mesmo número do painel do Mercado Ads. Em vermelho quando passa do ACOS alvo da campanha.</li>
      <li><b>TACOS</b> = investido ÷ receita total. Mostra quanto a publicidade pesa sobre tudo o que o anúncio vende.</li>
      <li>Período em dias completos, até ontem. Entram os anúncios que tiveram investimento ou venda por ads no período. O Mercado Livre limita a consulta a 90 dias.</li></ul></details>
    <div class="tbox"><table class="t adst"><thead><tr><th>Anúncio</th>${th("inv","Investido")}${th("ra","Receita ads")}${th("rt","Receita total")}${th("acos","ACOS")}${th("tacos","TACOS")}${th("cli","Cliques")}</tr></thead>
      <tbody>${linhas||`<tr><td colspan="7" class="muted">${DB.adsSemVenda?"Nenhum anúncio investiu sem vender neste período e filtro.":"Nenhum anúncio com investimento no período."}</td></tr>`}</tbody>
      ${l.length?`<tfoot><tr><td><b>Total da lista</b> <span class="t2">${n0(l.length)} anúncios</span></td><td class="r num"><b>${BRL(inv)}</b></td><td class="r num"><b>${BRL(ra)}</b></td><td class="r num"><b>${BRL(rt)}</b></td><td class="r num"><b>${adsFmtP(adsPct(inv,ra))}</b></td><td class="r num"><b>${adsFmtP(adsPct(inv,rt))}</b></td><td class="r num">${n0(S("cli"))}</td></tr></tfoot>`:""}
    </table></div>${P.html}</div>`;
}
