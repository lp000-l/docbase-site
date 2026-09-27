/* site.js —— 官网各页共用的行为（入场动效 / 锚点滚动 / 手机端抽屉与回顶 / 复制下载链接）
   从 index.html 抽出来，好让「更新手记」「反馈」独立成页时不必各抄一份。
   所有节点查询都做了空值保护：这些页面上不一定有下载卡。 */
    /* ===== 入场：一次编排好的错峰序列 =====
       阈值必须是 **0**，不能是 0.12。threshold 是「元素自身面积被看到多少比例」，
       而更新手记专页那个 <ol> 高 5785px、视口只有 600px —— 最大交叉比约 10%，
       永远够不到 12%，于是观察器一次都不触发，整页内容永久停在 opacity:0（用户看到的就是"空白页"）。
       0 的语义是「露出一像素就播」，才是这里真正想要的效果。 */
    if (window.IntersectionObserver) {
      /* 先加标记再观察：隐藏样式挂在 html.rv-ready 下，JS 没跑到就一直是普通可见 */
      document.documentElement.classList.add('rv-ready');
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e, i) => {
          if (e.isIntersecting) {
            setTimeout(() => e.target.classList.add('in'), i * 90);
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0, rootMargin: '0px 0px -40px 0px' });

      document.querySelectorAll('.rv').forEach((el, i) => { io.observe(el); });
    }


    /* ===== 锚点平滑滚动（尊重降级偏好） ===== */
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', function (ev) {
        const id = this.getAttribute('href');
        if (id === '#' || id.length < 2) return;
        const t = document.querySelector(id);
        if (!t) return;
        ev.preventDefault();
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      });
    });


    /* ===== 手机端：抽屉导航 ===== */
    const burger = document.getElementById('burger');
    const mnav   = document.getElementById('mnav');
    const mask   = document.getElementById('mnavMask');

    const menuOpen = () => mnav.classList.contains('open');

    function setMenu(on) {
      mnav.classList.toggle('open', on);
      mask.classList.toggle('open', on);
      burger.classList.toggle('open', on);
      burger.setAttribute('aria-expanded', on ? 'true' : 'false');
      burger.setAttribute('aria-label', on ? '收起导航' : '展开导航');
      document.body.classList.toggle('menu-open', on);   /* 锁背景滚动 */
    }

    burger.addEventListener('click', () => setMenu(!menuOpen()));
    mask.addEventListener('click', () => setMenu(false));

    /* 捕获阶段先收菜单（解开滚动锁），再让元素自身的平滑滚动跑 */
    mnav.addEventListener('click', ev => { if (ev.target.closest('a')) setMenu(false); }, true);

    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && menuOpen()) setMenu(false);
    });

    /* 转回桌面宽度时复位 */
    const mq640 = window.matchMedia('(max-width: 640px)');
    const onMq = ev => { if (!ev.matches) setMenu(false); };
    if (mq640.addEventListener) mq640.addEventListener('change', onMq);
    else if (mq640.addListener) mq640.addListener(onMq);


    /* ===== 手机端：回到顶部 ===== */
    const totop = document.getElementById('totop');
    /* 子页面（更新手记 / 反馈）没有这个按钮 —— 不做保护会直接 TypeError，
       于是整段脚本停在这儿，"复制下载链接"之类的后续行为也跟着没了。 */
    if (totop) {
      let scrollRaf = 0, idleTimer = 0;
      function onScroll() {
        /* 滚动期间淡化让道，停手后恢复 */
        totop.classList.add('scrolling');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => totop.classList.remove('scrolling'), 320);

        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          totop.classList.toggle('show', window.scrollY > 640);
        });
      }
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();

      totop.addEventListener('click', () => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      });
    }


    /* ===== 手机端：复制下载链接（手机下不了 exe，传链接到电脑更实际） ===== */
    const dlCopy = document.getElementById('dlCopy');
    const dlBtn  = document.querySelector('.dl-btn');
    /* 只有主页有下载卡；子页面上这些节点不存在，直接用会 TypeError */
    if (dlCopy) dlCopy.addEventListener('click', async () => {
      if (!dlBtn || dlCopy.dataset.busy) return;
      const url = new URL(dlBtn.getAttribute('href'), location.href).toString();
      let ok = false;
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch (e) {
        /* 非安全上下文（本地预览）退回老办法 */
        try {
          const ta = document.createElement('textarea');
          ta.value = url; ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
          document.body.appendChild(ta); ta.select();
          ok = document.execCommand('copy');
          ta.remove();
        } catch (e2) { ok = false; }
      }
      dlCopy.dataset.busy = '1';
      dlCopy.textContent = ok ? '已复制，传到电脑即可' : '复制失败，请长按上方按钮';
      dlCopy.classList.toggle('ok', ok);
      setTimeout(() => {
        dlCopy.textContent = '复制下载链接';
        dlCopy.classList.remove('ok');
        delete dlCopy.dataset.busy;
      }, 2400);
    });


    /* ===== 多线程分片下载（v1.4.2）=====
       官网这台机器在境外（欧洲节点），国内跨境单连接被丢包拖死：实测只有 12 KB/s。
       服务端已经启用 BBR（单连接升到 357 KB/s），这里再把安装包切成 8 段并发取
       （实测约 1 MB/s），并给出**真实进度**——用户抱怨的正是「进度基本不动」。
       拿得到文件句柄（Chrome / Edge 的 File System Access）就边下边写盘、不占内存；
       拿不到就退回内存拼 Blob（包太大时干脆交回浏览器）。任何一步不支持或出错都退回
       浏览器原生下载，绝不让用户卡在一个不动的地方。 */
    (() => {
      const btn = dlBtn, bar = document.getElementById('dlBar');
      if (!btn || !bar) return;                       /* 只有主页有下载卡 */
      const label = btn.querySelector('.dl-os');
      const meta = btn.querySelector('.dl-meta');
      const baseMeta = meta ? meta.textContent : '';
      const NSEG = 8;                                 /* 4 段→8 段只多约一成，再多无益 */
      const MB = 1048576;
      const f1 = n => (n / MB).toFixed(1);
      let ctl = null;                                 /* 下载中的 AbortController */

      function setIdle(txt, ms) {
        ctl = null;
        if (label) label.textContent = 'Windows 版';
        bar.hidden = true; bar.firstElementChild.style.width = '0';
        delete btn.dataset.busy; btn.removeAttribute('aria-busy');
        if (meta) {
          meta.textContent = txt || baseMeta;
          if (txt && ms) setTimeout(() => { if (meta && !btn.dataset.busy) meta.textContent = baseMeta; }, ms);
        }
      }
      function show(pct, txt) {
        bar.hidden = false;
        bar.firstElementChild.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
        if (txt && meta) meta.textContent = txt;
      }

      async function run(url, name, sha) {
        /* ① 服务端支不支持分段？nginx 对静态文件会回 Accept-Ranges: bytes */
        const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        const total = Number(head.headers.get('content-length')) || 0;
        const ar = (head.headers.get('accept-ranges') || '').toLowerCase();
        if (!head.ok || !total || !ar.includes('bytes')) throw new Error('no-range');

        /* ② 落盘方式：能拿文件句柄就流式写，拿不到就内存拼 */
        let fh = null;
        if (window.showSaveFilePicker) {
          fh = await window.showSaveFilePicker({
            suggestedName: name,
            types: [{ description: 'Windows 安装程序', accept: { 'application/octet-stream': ['.exe'] } }],
          });
        } else if (total > 150 * MB) {
          throw new Error('no-range');                /* 内存拼不下这么大的包 */
        }
        const wr = fh ? await fh.createWritable() : null;
        const parts = wr ? null : [];
        let chain = Promise.resolve();                /* 同一个流只能串行写 */
        const put = (pos, u8) => {
          if (!wr) { parts.push([pos, u8]); return; }
          chain = chain.then(() => wr.write({ type: 'write', position: pos, data: u8 }));
          return chain;
        };

        /* ③ 8 段并发取 */
        ctl = new AbortController();
        const seg = Math.ceil(total / NSEG);
        let got = 0, t0 = performance.now(), mark = 0, bw = 0;
        const tick = setInterval(() => {
          const now = performance.now(), dt = now - t0;
          if (dt > 400) {                             /* 滑动平均，免得数字乱跳 */
            const inst = (got - mark) / (dt / 1000);
            bw = bw ? bw * 0.55 + inst * 0.45 : inst;
            t0 = now; mark = got;
          }
          const left = bw > 0 ? (total - got) / bw : 0;
          show(got / total * 100, '正在取卷 ' + f1(got) + ' / ' + f1(total) + ' MB · '
            + (bw / MB).toFixed(1) + ' MB/s'
            + (left > 3 ? ' · 约 ' + Math.ceil(left / 60) + ' 分' + Math.round(left % 60) + ' 秒' : ''));
        }, 400);

        try {
          await Promise.all([...Array(NSEG)].map(async (_, i) => {
            const from = i * seg, to = Math.min(from + seg - 1, total - 1);
            if (from > to) return;
            const r = await fetch(url, { headers: { Range: 'bytes=' + from + '-' + to }, signal: ctl.signal, cache: 'no-store' });
            if (r.status !== 206) throw new Error('HTTP ' + r.status);
            const rd = r.body.getReader();
            let pos = from;
            for (;;) {
              const { done, value } = await rd.read();
              if (done) break;
              await put(pos, value);
              pos += value.length; got += value.length;
            }
          }));
          await chain;                                /* 等最后几笔写完 */
        } finally { clearInterval(tick); }

        /* ④ 校对 + 交付：与页面上那张校验码表同源（purity.json 里的 sha256） */
        show(100, '正在校对 SHA-256…');
        let file, ok = null;
        if (wr) { await wr.close(); file = await fh.getFile(); }
        else {
          parts.sort((a, b) => a[0] - b[0]);
          file = new Blob(parts.map(p => p[1]), { type: 'application/octet-stream' });
        }
        if (sha && window.crypto && crypto.subtle) {
          try {
            const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
            ok = [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()
              === String(sha).toUpperCase();
          } catch (e) { ok = null; }
        }
        if (!wr) {                                    /* 内存路径：交给浏览器存盘 */
          const a = document.createElement('a');
          a.href = URL.createObjectURL(file); a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        }
        setIdle(ok === true ? '已保存，校验一致 ✓'
          : ok === false ? '已保存，但校验不一致 —— 请重新下载' : '已保存', 8000);
      }

      btn.addEventListener('click', async (e) => {
        /* 老浏览器、以及 ?native（排障后门）都交回浏览器原生下载 */
        if (!window.fetch || !window.ReadableStream || !(window.crypto && crypto.subtle)) return;
        if (new URLSearchParams(location.search).has('native')) return;
        if (btn.dataset.busy === '1') { if (ctl) ctl.abort(); return; }     /* 下载中再点一次 = 取消 */
        e.preventDefault();
        const url = new URL(btn.getAttribute('href'), location.href).toString();
        const name = (btn.getAttribute('href') || 'setup.exe').split('/').pop();
        btn.dataset.busy = '1'; btn.setAttribute('aria-busy', 'true');
        if (label) label.textContent = '正在取卷…';
        show(0, '正在连接…');
        try {
          await run(url, name, window.__dlSha || '');
        } catch (err) {
          const nm = (err && err.name) || '';
          /* 用户取消（含在「另存为」对话框里点了取消）：安静收场，再点一次即可重来 */
          if (nm === 'AbortError') { setIdle(); return; }
          /* 分段/句柄这些能力不支持，或用户拒了权限：退回浏览器原生下载 */
          if ((err && err.message === 'no-range') || nm === 'NotAllowedError' || nm === 'SecurityError' || nm === 'TypeError') {
            setIdle(); location.href = url; return;
          }
          setIdle('下载中断：' + ((err && err.message) || err) + '（可再点一次继续）', 8000);
        }
      });
    })();
