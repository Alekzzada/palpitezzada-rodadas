(function(){
var sha=null, app=document.getElementById('app'), hora=document.getElementById('hora');
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function brl(n){n=Number(n)||0;return (n<0?'−':'')+'R$ '+Math.abs(n).toLocaleString('pt-BR',{maximumFractionDigits:2})}
function sinal(n){return (n>0?'+':'')+brl(n)}
function cor(n){return n>0?'g':n<0?'r':''}
function pill(e){
  if(e.status==='green')return '<span class="pill pg">GREEN '+sinal(e.lucro)+'</span>';
  if(e.status==='red')return '<span class="pill pr">RED '+sinal(e.lucro||-e.stake)+'</span>';
  return '<span class="pill py">PENDENTE</span>';
}
function toast(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove()},4500)}
function dataBR(s){if(!s)return'';var p=s.slice(0,10).split('-');return p[2]+'/'+p[1]}

function render(d){
  var r=d.rodada||{}, a=r.analise||{}, es=(r.entradas||[]).slice().sort(function(x,y){return (x.ordem||9)-(y.ordem||9)}), h=d.historico||[];
  var hoje=es.length?es[0].data:'', lucroHoje=0, risco=0;
  es.forEach(function(e){if(e.status==='green'||e.status==='red')lucroHoje+=Number(e.lucro)||(e.status==='red'?-e.stake:0);else risco+=Number(e.stake)||0});
  var ult7=h.slice(-7), sem=ult7.reduce(function(s,x){return s+x.lucro},0);
  var mes=h.filter(function(x){return x.data&&x.data.slice(0,7)===(hoje||'').slice(0,7)}).reduce(function(s,x){return s+x.lucro},0);
  var banca=r.banca&&r.banca.atual;
  var o='';
  o+='<h1>'+esc(a.titulo||'Rodada do dia')+'</h1><p class="lead">'+esc(a.resumo||'')+'</p>';
  o+='<div class="kpis"><div class="k"><small>Banca</small><b>'+(banca?brl(banca):'—')+'</b></div>'+
     '<div class="k"><small>Hoje</small><b class="'+cor(lucroHoje)+'">'+sinal(lucroHoje)+'</b></div>'+
     '<div class="k"><small>Em jogo agora</small><b class="y">'+brl(risco)+'</b></div>'+
     '<div class="k"><small>Mês</small><b class="'+cor(mes)+'">'+sinal(mes)+'</b></div></div>';
  o+='<h2>Entradas de '+dataBR(hoje)+'</h2><div class="cards">';
  es.forEach(function(e){
    var legs=(e.pernas||[]).map(function(p){return '<div class="leg"><span>'+esc(p[0])+(p[2]?'<em>'+esc(p[2])+'</em>':'')+'</span><span>'+esc(p[1])+'</span></div>'}).join('');
    o+='<div class="card'+(e.status==='pendente'&&/Premium|Melzinho/.test(e.tipo)?' destaque':'')+'"><div class="row"><div><div class="tag">'+esc(e.tipo)+' · '+brl(e.stake)+'</div><div class="tit">'+esc(e.titulo)+'</div></div><div class="odd">@'+esc(e.odd)+'</div></div>'+
       '<div class="meta"><span>Chance <b>'+esc(e.chance)+'</b></span><span>Odd justa <b>'+esc(e.justa)+'</b></span><span>'+pill(e)+'</span></div>'+legs+
       (e.resultado?'<div class="res">'+esc(e.resultado)+'</div>':'')+
       (e.porque?'<div class="nota">'+esc(e.porque)+'</div>':'')+(e.nota?'<div class="nota">⚠ '+esc(e.nota)+'</div>':'')+'</div>';
  });
  o+='</div>';
  if(a.pontos&&a.pontos.length){
    o+='<h2>Análise do dia</h2><div class="card ana">'+a.pontos.map(function(p){return '<div class="pt"><b>'+esc(p[0])+'</b>'+esc(p[1])+'</div>'}).join('')+(a.risco?'<div class="risco">'+esc(a.risco)+'</div>':'')+'</div>';
  }
  if(r.jogos&&r.jogos.length){
    o+='<h2>Jogos analisados</h2><div class="card"><table><tr><th>Hora</th><th>Jogo</th><th class="hide-m">Liga</th><th>Casa · X · Fora</th></tr>'+
      r.jogos.map(function(j){return '<tr><td class="n">'+esc(j[0])+'</td><td>'+esc(j[1])+'<div class="nota">'+esc(j[8]||'')+'</div></td><td class="hide-m">'+esc(j[2])+'</td><td class="n">'+j[3]+' · '+j[4]+' · '+j[5]+'%</td></tr>'}).join('')+'</table></div>';
  }
  if(h.length){
    var mx=Math.max.apply(null,h.map(function(x){return Math.abs(x.lucro)}).concat([1]));
    o+='<h2>Ganhos e perdas · últimos dias</h2><div class="card"><div class="row"><span class="tag">Semana (7 dias)</span><b class="'+cor(sem)+'">'+sinal(sem)+'</b></div><div class="bars">'+
      h.slice(-14).map(function(x){var ht=Math.max(3,Math.round(Math.abs(x.lucro)/mx*110));return '<div class="bar" title="'+sinal(x.lucro)+'"><span>'+(x.pend?'…':(x.lucro>0?'+':'')+Math.round(x.lucro))+'</span><div style="height:'+ht+'px;background:'+(x.lucro>=0?'var(--neon)':'var(--red)')+'"></div><small>'+dataBR(x.data)+'</small></div>'}).join('')+
      '</div></div>';
  }
  app.innerHTML=o;
}

function buscar(primeira){
  fetch('/api/rodada'+(sha?'?sha='+sha:''),{cache:'no-store'}).then(function(r){
    if(r.status===401){location.reload();return}
    if(r.status===204)return;
    return r.json().then(function(d){
      if(!d.rodada){app.innerHTML='<p class="vazio">Rodada ainda não carregada. Tentando de novo…</p>';return}
      var nova=sha&&d.sha!==sha; sha=d.sha; render(d); if(nova)toast('Rodada atualizada agora');
    });
  }).catch(function(){}).then(function(){hora.textContent='ao vivo · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})});
}
buscar(true);
setInterval(function(){if(!document.hidden)buscar()},8000);
document.addEventListener('visibilitychange',function(){if(!document.hidden)buscar()});
})();
