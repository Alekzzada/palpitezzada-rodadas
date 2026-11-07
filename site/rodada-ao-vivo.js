/*
 * Palpitezzada · Rodada ao vivo
 * Busca o rodada.json direto do GitHub assim que a página abre e de novo a cada 45s.
 * Quando sai uma rodada nova (Melzinho, Bingo, Bilhete dos Sonhos, Premium),
 * o site atualiza sozinho em até ~1 minuto, sem novo deploy e sem F5.
 *
 * Como usar no site (ShardCloud):
 *   1. Cole este arquivo na pasta pública do site (ex.: public/rodada-ao-vivo.js).
 *   2. No HTML, antes do </body>:  <script src="/rodada-ao-vivo.js"></script>
 *   3. Na função que hoje desenha a rodada, troque a leitura antiga por:
 *        window.addEventListener('rodada:atualizada', e => desenharRodada(e.detail));
 *      (desenharRodada = a função do site que monta os cards a partir do JSON)
 */
(function () {
  var REPO = 'Alekzzada/palpitezzada-rodadas';
  var INTERVALO = 45000; // 45 segundos
  var ultimoSha = null;
  var ultimaRodada = null;

  function avisar(texto) {
    try {
      var t = document.createElement('div');
      t.textContent = texto;
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
        'background:#0b140e;color:#39ff7a;border:1px solid #39ff7a;padding:10px 18px;' +
        'border-radius:99px;font:600 14px system-ui,sans-serif;z-index:99999;' +
        'box-shadow:0 0 18px rgba(57,255,122,.3)';
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, 4000);
    } catch (e) {}
  }

  function publicar(dados, nova) {
    ultimaRodada = dados;
    window.rodadaAtual = dados;
    window.dispatchEvent(new CustomEvent('rodada:atualizada', { detail: dados }));
    if (nova) avisar('Rodada atualizada · ' + (dados.analise && dados.analise.titulo || 'novas entradas'));
  }

  function buscar() {
    // 1) qual é o último commit (cache máx. 60s no GitHub)
    return fetch('https://api.github.com/repos/' + REPO + '/commits/main', {
      headers: { Accept: 'application/vnd.github.sha' }, cache: 'no-store'
    })
      .then(function (r) { if (!r.ok) throw new Error('sha ' + r.status); return r.text(); })
      .then(function (sha) {
        sha = sha.trim();
        if (sha === ultimoSha && ultimaRodada) return; // nada novo
        // 2) o arquivo exato daquele commit (nunca vem de cache antigo)
        return fetch('https://raw.githubusercontent.com/' + REPO + '/' + sha + '/rodada.json', { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('json ' + r.status); return r.json(); })
          .then(function (dados) {
            var nova = ultimoSha !== null;
            ultimoSha = sha;
            publicar(dados, nova);
          });
      })
      .catch(function () {
        // plano B: arquivo da branch main (pode ter até 5 min de atraso)
        if (ultimaRodada) return;
        return fetch('https://raw.githubusercontent.com/' + REPO + '/main/rodada.json?t=' + Date.now(), { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (dados) { publicar(dados, false); })
          .catch(function () {});
      });
  }

  window.carregarRodada = buscar;
  buscar();
  setInterval(function () { if (!document.hidden) buscar(); }, INTERVALO);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) buscar(); });
})();
