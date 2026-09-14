/**
 * The page the companion serves.
 *
 * A tablet on a music stand is not a browser anyone maintains: it has no build step, no
 * CDN and no network beyond the show's own, so the stylesheet and the script are inline
 * and the page asks for exactly two things — the state it missed and the stream of the
 * ones it did not. Nothing from the show is ever written as markup: every value goes in
 * through `textContent`, which is why a cue called `<script>` stays a cue name.
 */

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <title>WinsLab Companion</title>
    <style>
      :root {
        --bg: #0e1013;
        --panel: #171a20;
        --line: #262b33;
        --ink: #eceae6;
        --dim: #9aa3ae;
        --next: #ffd166;
        --live: #7ee081;
        --warn: #ffb454;
        --crit: #ff6b6b;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: var(--bg); color: var(--ink); }
      body {
        font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        -webkit-text-size-adjust: 100%;
      }
      main { display: grid; gap: 14px; padding: 14px; max-width: 1100px; margin: 0 auto; }
      .top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
      #workspace { font-size: 20px; font-weight: 600; overflow-wrap: anywhere; }
      #freshness { color: var(--dim); font-size: 13px; white-space: nowrap; }
      h2 {
        margin: 0 0 8px; font-size: 13px; letter-spacing: 0.08em;
        text-transform: uppercase; color: var(--dim);
      }
      .path { color: var(--dim); font-size: 12px; text-transform: none; letter-spacing: 0; }
      section {
        background: var(--panel); border: 1px solid var(--line);
        border-radius: 12px; padding: 14px;
      }
      #next { border-color: #4a3d10; background: #1c1a12; }
      /* The one thing read from across a pit, so it is the one thing set at stage size. */
      #next-number { color: var(--next); font-size: 22px; font-weight: 700; letter-spacing: 0.04em; min-height: 1.2em; }
      #next-name { font-size: 42px; line-height: 1.1; font-weight: 700; overflow-wrap: anywhere; }
      ul, ol { list-style: none; margin: 0; padding: 0; }
      li { display: flex; gap: 10px; align-items: baseline; padding: 7px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
      li:first-child { border-top: 0; }
      .cue-number, .order-number { color: var(--dim); font-variant-numeric: tabular-nums; min-width: 2.6em; }
      .cue-name, .order-name { flex: 1; }
      .cue-state { color: var(--live); font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; }
      .order-cue { padding-left: 8px; }
      .order-cue.is-child { padding-left: 30px; }
      .order-cue.is-next { background: #2a2410; border-radius: 6px; }
      .order-cue.is-next .order-number, .order-cue.is-next .order-name { color: var(--next); font-weight: 700; }
      .order-cue.is-live .order-name { color: var(--live); }
      .script-line {
        display: block; padding: 3px 8px; font-size: 19px; line-height: 1.5;
        white-space: pre-wrap; overflow-wrap: anywhere;
      }
      .script-line.is-current {
        box-shadow: inset 3px 0 0 var(--next);
        background: #2a2410; border-radius: 6px; font-weight: 600;
      }
      .alert { border-left: 3px solid var(--warn); padding-left: 10px; border-top: 0; }
      .alert-critical { border-left-color: var(--crit); }
      .alert-info { border-left-color: var(--dim); }
      .empty { color: var(--dim); margin: 0; }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    <main id="companion">
      <div class="top">
        <div id="workspace"></div>
        <div id="freshness">waiting for the show</div>
      </div>

      <section id="next">
        <h2>Next</h2>
        <div id="next-number"></div>
        <div id="next-name"></div>
      </section>

      <section>
        <h2>Running now</h2>
        <ul id="running-cues"></ul>
        <p id="running-empty" class="empty">Nothing running</p>
      </section>

      <section>
        <h2>Running order</h2>
        <ol id="running-order"></ol>
      </section>

      <section>
        <h2>Script <span id="script-path" class="path"></span></h2>
        <ol id="script-lines"></ol>
        <p id="script-empty" class="empty">No script loaded</p>
      </section>

      <section>
        <h2>Recent alarms</h2>
        <ul id="alerts"></ul>
        <p id="alerts-empty" class="empty">No alarms</p>
      </section>
    </main>
    <script>
      (function () {
        'use strict';
        var token = new URLSearchParams(window.location.search).get('token') || '';
        var stateUrl = '/state?token=' + encodeURIComponent(token);
        var streamUrl = '/events?token=' + encodeURIComponent(token);
        var MAX_ALERTS = 8;

        function byId(id) { return document.getElementById(id); }
        function setText(node, value) {
          node.textContent = value === null || value === undefined ? '' : String(value);
        }
        function setShown(node, shown) { node.hidden = !shown; }
        function row(className) {
          var item = document.createElement('li');
          item.className = className;
          return item;
        }
        function span(className, value) {
          var node = document.createElement('span');
          node.className = className;
          setText(node, value);
          return node;
        }
        function levelClass(level) {
          return level === 'critical' || level === 'warning' ? level : 'info';
        }

        function renderNext(next) {
          setText(byId('next-number'), next && next.number ? next.number : '\\u2014');
          setText(byId('next-name'), next ? next.name : 'Nothing selected');
        }

        function renderRunning(running) {
          var list = byId('running-cues');
          list.textContent = '';
          for (var i = 0; i < running.length; i++) {
            var entry = running[i];
            var item = row('running-cue');
            item.appendChild(span('cue-number', entry.number));
            item.appendChild(span('cue-name', entry.name));
            item.appendChild(span('cue-state', entry.state));
            list.appendChild(item);
          }
          setShown(byId('running-empty'), running.length === 0);
        }

        function renderOrder(cues, next, running) {
          var live = {};
          for (var i = 0; i < running.length; i++) live[running[i].id] = true;
          var list = byId('running-order');
          list.textContent = '';
          for (var j = 0; j < cues.length; j++) {
            var cue = cues[j];
            var classes = 'order-cue';
            if (cue.parentId) classes += ' is-child';
            if (next && cue.id === next.id) classes += ' is-next';
            if (live[cue.id]) classes += ' is-live';
            var item = row(classes);
            item.dataset.cueId = cue.id;
            item.appendChild(span('order-number', cue.number));
            item.appendChild(span('order-name', cue.name));
            list.appendChild(item);
          }
        }

        function renderScript(script, next) {
          var lines = script && script.lines ? script.lines : [];
          // Script lines are numbered from one, and so is the pin a cue carries.
          var current = next && typeof next.scriptLine === 'number' ? next.scriptLine : 0;
          var list = byId('script-lines');
          list.textContent = '';
          for (var i = 0; i < lines.length; i++) {
            var item = row('script-line');
            item.dataset.line = String(i + 1);
            if (current === i + 1) item.className += ' is-current';
            setText(item, lines[i]);
            list.appendChild(item);
          }
          setShown(byId('script-lines'), lines.length > 0);
          setShown(byId('script-empty'), lines.length === 0);
          setText(byId('script-path'), script ? script.path : '');
          var marked = list.querySelector('.is-current');
          if (marked && marked.scrollIntoView) {
            try {
              marked.scrollIntoView({ block: 'center' });
            } catch (error) {
              // A tablet that cannot scroll the line still shows it marked.
            }
          }
        }

        function renderAlerts(alerts) {
          var recent = alerts.slice(-MAX_ALERTS).reverse();
          var list = byId('alerts');
          list.textContent = '';
          for (var i = 0; i < recent.length; i++) {
            var entry = recent[i];
            var item = row('alert alert-' + levelClass(entry.level));
            setText(item, entry.message);
            list.appendChild(item);
          }
          setShown(byId('alerts-empty'), recent.length === 0);
        }

        function renderFreshness(state) {
          if (!state.at) { setText(byId('freshness'), 'waiting for the show'); return; }
          var age = Math.max(0, Math.round((Date.now() - state.at) / 1000));
          setText(byId('freshness'), age < 2 ? 'live' : 'published ' + age + 's ago');
        }

        function render(state) {
          state = state || {};
          setText(byId('workspace'), state.workspaceName || 'Untitled show');
          renderFreshness(state);
          renderNext(state.nextCue || null);
          renderRunning(state.running || []);
          renderOrder(state.cues || [], state.nextCue || null, state.running || []);
          renderScript(state.script || null, state.nextCue || null);
          renderAlerts(state.alerts || []);
        }

        function load() {
          window.fetch(stateUrl, { cache: 'no-store' })
            .then(function (response) { return response.json(); })
            .then(render)
            .catch(function () { setText(byId('freshness'), 'companion offline'); });
        }

        function subscribe() {
          if (typeof window.EventSource !== 'function') return;
          // EventSource reconnects on its own; the page only has to redraw what arrives.
          var source = new window.EventSource(streamUrl);
          source.onmessage = function (event) {
            try {
              render(JSON.parse(event.data));
            } catch (error) {
              // A frame that will not parse is not worth dropping the stream over.
            }
          };
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () { load(); subscribe(); });
        } else {
          load();
          subscribe();
        }
      })();
    </script>
  </body>
</html>
`

/** The page the tablet is served, assembled once and handed out on every reload. */
export function companionPage(): string {
  return PAGE
}
