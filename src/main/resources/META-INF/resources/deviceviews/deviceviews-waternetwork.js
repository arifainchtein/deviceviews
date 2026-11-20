// deviceviews water network (2026-11-20): a farm's water as a live diagram, the same on the Teleonome (Annabelle's
// page) and on devices.digitalstables.com. Made from the agreed mockup (framework/claude/water-network-2026-11-19/
// waternetwork-mockup.html). A network has
//   sources       a telepathon whose meters measure water leaving it (Pool's pump), or a tank (a level, an area,
//                 rain onto it, an overflow), or a source without a meter (a stream: worked out from the tank it feeds)
//   measuring points   a telepathon whose meters measure water passing through (PipeSplit)
//   defined sinks a named flow range on a meter, learned by dragging across its chart (Greenhouse Hose 6-13 l/m)
//   pipes         outlet -> inlet; a meter whose role is "Physical Sink" measures water leaving the network
// and checks: do the meters after an outlet add up to it (a leak between them), is every litre on a meter explained
// by its defined sinks, and how much water came into a tank without a meter (rain, a stream) in the last hour.
//
// The network is stored as ONE DeneChain, "Water Network <name>" (Purpose nucleus on the Teleonome, sperm
// WaterNetworks; the same JSON in devices.digitalstables.com's database). Each element is a dene:
//   "Water Network Settings"   Network Name, Balance Tolerance, Minimum Flow, Alert After Seconds, Active
//   "Water Source" / "Water Measuring Point"   one per telepathon in the network (dene name = telepathon name):
//       Source Kind (Telepathon | Tank | Unmetered), Telepathon Pointer, Meter <n> Pointer / Role / Name,
//       tanks: Shape, Level Pointer, Level Units (% | mm | cm), Capacity (L, when full), Surface Area (m2), Height When Full (mm),
//       Overflow Height (mm), Overflow Lip Width (m), Rain Catchment Area (m2), Rain Falls On Surface
//       unmetered: What It Is
//       a tank without a sensor (2026-11-20, TopTank before its Daffodil): Source Kind Tank, Has Sensor false, no
//       Telepathon Pointer; a telepathon of the same name later is used as its sensor (or link one in its sheet)
//   "Water Defined Sink"       Learned On Pointer, Minimum Flow, Maximum Flow, Learned From, Learned To
//   "Water Connection"         From, To (pointers), From Port "Overflow" for a tank's overflow outlet
// Pointers: a meter is @<Teleonome>:Telepathons:<telepathon>:Purpose:<word>, anything else is the element's own
// dene, @<Teleonome>:Purpose:<chain>:<element>.
//
// Plain DOM and SVG, text set with textContent only; Bootstrap 3 buttons. Needs deviceviews-base.js
// (DeviceViewsHost.fetchHistory for the chart and the tank balances).
//
//   var wn = DeviceViewsWaterNetwork.create({
//     view: element, teleonomeName: "Annabelle",
//     chain: {...} or null,              // the stored DeneChain; null = a new network, opened in edit mode
//     name: "Farm water",                // a new network's name
//     chainPrefix: "Water Network ",
//     telepathons: function() { return [...]; },
//     canEdit: true, needsCode: true,
//     save: function(chain, oldChainName, code) { return Promise },   // oldChainName null: a new network
//     remove: function(chainName, code) { return Promise },
//     removed: function() {},            // after a remove went through
//     note: "...",                       // optional: a line under the name (devices.digitalstables.com: where to change it)
//     sync: {label, status: function() { return Promise(text) }, send: function() { return Promise(text) }}
//                                        // optional: a button next to Edit (the Teleonome: "Update Digital Stables")
//   });
//   wn.render();          // draw into view (again)
//   wn.setChain(chain);   // the stored network changed (ignored while editing)

var DeviceViewsWaterNetwork = (function() {

	var NS = 'http://www.w3.org/2000/svg';
	var SINK_COLORS = ['#8e44ad', '#d35400', '#16a085', '#2c3e50', '#b03a2e', '#7d6608'];
	var ROLE_WORDS = {outflow: 'Outflow', measuring: 'Measuring', sink: 'Physical Sink'};
	var STALE_APART_SECONDS = 180;   // meters read further apart than this are not compared
	var HISTORY_MS = 3600000;
	var RANGES = [['Last hour', 3600000], ['Last 6 hours', 21600000], ['Last 24 hours', 86400000], ['Last 2 days', 172800000], ['Last 7 days', 604800000]];

	// ---------- small helpers ----------
	function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
	function S(tag, attrs, parent, text) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e; }
	function f(v) { return v == null ? '—' : v < 0.05 ? '0' : v.toFixed(1); }
	function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) || n === -99 ? null : n; }
	function avg(a) { return a.reduce(function(s, x) { return s + x; }, 0) / a.length; }
	function cleanName(s) { return String(s || '').replace(/[:@#]/g, '').replace(/\s+/g, ' ').trim(); }
	function two(n) { return (n < 10 ? '0' : '') + n; }
	function hhmm(ms) { var d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()); }
	function stamp(ms) { var d = new Date(ms); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()); }
	function parseTime(s) { var t = Date.parse(String(s).replace(' ', 'T')); return isNaN(t) ? null : t; }

	function deneNamed(t, name) { return ((t && t.Denes) || []).filter(function(d) { return d.Name === name; })[0] || null; }
	function wordNamed(dene, name) { return ((dene && dene.DeneWords) || []).filter(function(w) { return w.Name === name; })[0] || null; }
	function wordValue(dene, name) { var w = wordNamed(dene, name); return w ? w.Value : undefined; }

	var stylesAdded = false;
	function addStyles() {
		if (stylesAdded) return;
		stylesAdded = true;
		var css = [
			'.dvw{--wbg:#fff;--wtext:#1d2420;--wmuted:#5f6b64;--wline:#d5dbd7;--wtile:#f0f4f1;--waccent:#2f7d4f;--wwater:#2a7fd4;--wwater-soft:#d6eaf8;',
			'--widle:#b8c2bc;--wbad:#c0392b;--wbad-soft:#fadbd8;--wwarn:#9a7d0a;--wwarn-soft:#fcf3cf;--wok:#1d6b40;--wok-soft:#d5f5e3;--wsel:#f39c12;color:var(--wtext)}',
			'.dvw .dvw-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}',
			'.dvw .dvw-head h2{margin:0;font-size:20px}.dvw h3{margin:0;font-size:16px}',
			'.dvw .dvw-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px}',
			'@media (max-width:860px){.dvw .dvw-grid{grid-template-columns:minmax(0,1fr)}}',
			'.dvw .dvw-card{border:1px solid var(--wline);border-radius:10px;padding:12px;margin-bottom:14px;min-width:0;background:var(--wbg)}',
			'.dvw .dvw-hint{background:var(--wwater-soft);border-radius:8px;padding:7px 10px;font-size:13px;margin-bottom:8px}',
			'.dvw svg.dvw-net{width:100%;height:auto;display:block;user-select:none;-webkit-user-select:none}',
			'.dvw .pipe{fill:none;stroke-linecap:round;stroke-linejoin:round}.dvw .pipe.bed{stroke:var(--widle);opacity:.35}',
			'.dvw .pipe.flow{stroke:var(--wwater);stroke-dasharray:10 12;animation:dvwflow linear infinite}.dvw .pipe.flow.bad{stroke:var(--wbad)}',
			'.dvw .pipe.hit{stroke:transparent;stroke-width:24;pointer-events:stroke}.dvw .editing .pipe.hit{cursor:pointer}.dvw .pipe.bed.hl{stroke:var(--wbad);opacity:.6}',
			'@keyframes dvwflow{to{stroke-dashoffset:-44}}',
			'.dvw .node rect.box{fill:var(--wbg);stroke:var(--wline);stroke-width:1.5}.dvw .node.src rect.box{stroke:var(--wwater)}.dvw .node.mp rect.box{stroke:var(--waccent)}',
			'.dvw .node.dsink rect.box{stroke-dasharray:5 4}.dvw .node.est rect.box{stroke:var(--wwater);stroke-dasharray:2 4}.dvw .node.loose rect.box{stroke:var(--wwarn)}',
			'.dvw .node.active rect.box{fill:var(--wwater-soft)}.dvw .editing .node{cursor:pointer}.dvw .editing .node:hover rect.box{stroke-width:3}',
			'.dvw .node text{fill:var(--wtext)}.dvw .t-name{font-weight:700}.dvw .node text.t-sub{fill:var(--wmuted)}.dvw .t-val{font-weight:700;font-variant-numeric:tabular-nums}',
			'.dvw .tankfill{fill:var(--wwater);opacity:.4;stroke:none}.dvw .tankline{fill:none;stroke:var(--wmuted);stroke-width:1.5}',
			'.dvw .port{stroke:var(--wwater);stroke-width:2}.dvw .port.out{fill:var(--wwater)}.dvw .port.in{fill:var(--wbg)}',
			'.dvw .port.sel{stroke:var(--wsel);stroke-width:4}.dvw .port.target{stroke:var(--wsel);animation:dvwpulse 1s ease-in-out infinite}@keyframes dvwpulse{50%{stroke-width:5}}',
			'.dvw .badge text{font-size:12px;font-weight:700}.dvw .badge.ok rect{fill:var(--wok-soft)}.dvw .badge.ok text{fill:var(--wok)}',
			'.dvw .badge.bad rect{fill:var(--wbad-soft)}.dvw .badge.bad text{fill:var(--wbad)}.dvw .badge.warn rect{fill:var(--wwarn-soft)}.dvw .badge.warn text{fill:var(--wwarn)}',
			'.dvw .cloud path{fill:var(--wbg);stroke:var(--wwater);stroke-width:1.5}.dvw .cloud text{font-size:12px;font-weight:700;fill:var(--wwater)}',
			'.dvw .dvw-tray{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;font-size:13px}',
			'.dvw .dvw-chip{font:inherit;font-size:13px;font-weight:600;border:1px dashed var(--wline);border-radius:999px;background:var(--wbg);color:var(--wtext);padding:4px 11px;cursor:pointer}',
			'.dvw .dvw-checks{display:flex;flex-direction:column;border:1px solid var(--wline);border-radius:8px;overflow:hidden}',
			'.dvw .dvw-check{border-top:1px solid var(--wline)}.dvw .dvw-check:first-child{border-top:0}',
			'.dvw .dvw-check button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;cursor:pointer}',
			'.dvw .dvw-check .ct{flex:1;font-weight:600;min-width:0}.dvw .dvw-check .cv{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;text-align:right}',
			'.dvw .dvw-check .cd{display:none;font-size:13px;color:var(--wmuted);padding:0 10px 9px 28px}.dvw .dvw-check.open .cd{display:block}',
			'.dvw .dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--widle)}.dvw .ok .dot{background:var(--wok)}.dvw .bad .dot{background:var(--wbad)}.dvw .warn .dot{background:var(--wwarn)}',
			'.dvw .dvw-check.bad .cv{color:var(--wbad)}',
			'.dvw svg.dvw-chart{width:100%;height:auto;display:block;cursor:crosshair;touch-action:none}',
			'.dvw .dvw-chart .ax{stroke:var(--wline)}.dvw .dvw-chart text{fill:var(--wmuted);font-size:11px}',
			'.dvw .dvw-chart .ln{fill:none;stroke:var(--wwater);stroke-width:2}.dvw .dvw-chart .ln2{fill:none;stroke:var(--wmuted);stroke-width:1.5;stroke-dasharray:4 3}',
			'.dvw .dvw-chart .selr{fill:var(--wwater);opacity:.18}',
			'.dvw .dvw-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--wmuted);margin-top:6px}.dvw .dvw-legend span{display:inline-flex;align-items:center;gap:5px}',
			'.dvw .sw{width:12px;height:12px;border-radius:3px;flex:none;display:inline-block}',
			'.dvw .dvw-savebar{position:sticky;bottom:0;background:var(--wbg);border-top:1px solid var(--wline);padding:10px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;z-index:5}',
			'.dvw .dvw-savebar .msg{flex:1 1 160px;font-size:13px}.dvw .dvw-savebar input{width:9ch;text-align:center;letter-spacing:.15em}',
			'.dvw-shade{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1040}',
			'.dvw-sheet{position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:460px;background:#fff;color:#1d2420;border-radius:14px 14px 0 0;padding:16px 16px 20px;z-index:1041;max-height:85vh;overflow:auto}',
			'@media (min-width:700px){.dvw-sheet{bottom:auto;top:50%;transform:translate(-50%,-50%);border-radius:12px}}',
			'.dvw-sheet h3{margin:0 0 2px;font-size:17px}.dvw-sheet label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}',
			'.dvw-sheet .seg{display:flex;border:1px solid #d5dbd7;border-radius:8px;overflow:hidden;margin-top:6px}',
			'.dvw-sheet .seg button{flex:1;font:inherit;font-size:13px;font-weight:600;border:0;background:#fff;padding:8px 6px;cursor:pointer;border-left:1px solid #d5dbd7}',
			'.dvw-sheet .seg button:first-child{border-left:0}.dvw-sheet .seg button.on{background:#2f7d4f;color:#fff}',
			'.dvw-sheet .mrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}.dvw-sheet .mrow .ml{min-width:7em;font-size:13px}.dvw-sheet .mrow select{flex:1}',
			'.dvw-sheet .acts{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:16px}',
			'.dvw-sheet .stat{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}.dvw-sheet .stat div{background:#f0f4f1;border-radius:6px;padding:6px;text-align:center;font-size:12px}.dvw-sheet .stat b{display:block;font-size:16px}',
			'.dvw-sheet select,.dvw-sheet input[type=text],.dvw-sheet input[type=number]{font:inherit;font-size:14px;padding:6px 8px;border:1px solid #d5dbd7;border-radius:6px;max-width:100%}',
			'.dvw-sheet .muted,.dvw .muted{color:#5f6b64}.dvw [hidden],.dvw-sheet [hidden]{display:none!important}'
		].join('\n');
		var s = document.createElement('style');
		s.textContent = css;
		document.head.appendChild(s);
	}

	// ---------- the stored DeneChain <-> the network being drawn ----------
	//
	// st = {name, settings, telepathons: {name: {role, tank, ...}}, meterRole: {"T:word": role}, meterNames: {},
	//       sinks: [{name, min, max, meter, from, to, color}], conns: [[fromKey, toKey]], unmetered: [{name, what}]}
	// Keys: "T:word" a meter's outlet (and inlet), "T" a telepathon's own inlet/outlet, "T overflow" a tank's
	// overflow outlet, a sink's or an unmetered source's name.

	function W(name, value, type, dwt, units) {
		var w = {"Name": name, "Value": value, "Value Type": type, "Required": true};
		if (dwt) w["DeneWord Type"] = dwt;
		if (units) w["Units"] = units;
		return w;
	}

	function emptyState(name) {
		return {name: name, settings: {tolerance: 1.0, minFlow: 0.5, alertAfter: 90, active: true},
			telepathons: {}, meterRole: {}, meterNames: {}, sinks: [], conns: [], unmetered: []};
	}

	// pointer -> key, given the chain's name (null when it points elsewhere)
	function keyOf(pointer, chainName, overflow) {
		var p = typeof pointer === 'string' && pointer.charAt(0) === '@' ? pointer.substring(1).split(':') : [];
		if (p.length === 5 && p[1] === 'Telepathons') return p[2] + ':' + p[4];
		if (p.length === 3 && p[1] === 'Telepathons') return p[2];
		if (p.length === 4 && p[1] === 'Purpose' && p[2] === chainName) return p[3] + (overflow ? ' overflow' : '');
		return null;
	}

	function fromChain(chain, prefix) {
		var chainName = chain.Name, st = emptyState(chainName.indexOf(prefix) === 0 ? chainName.substring(prefix.length) : chainName);
		var colorIx = 0;
		(chain.Denes || []).forEach(function(d) {
			var type = d["Dene Type"];
			if (type === 'Water Network Settings') {
				st.name = wordValue(d, 'Network Name') || st.name;
				var t = num(wordValue(d, 'Balance Tolerance')), m = num(wordValue(d, 'Minimum Flow')), a = num(wordValue(d, 'Alert After Seconds'));
				if (t !== null) st.settings.tolerance = t;
				if (m !== null) st.settings.minFlow = m;
				if (a !== null) st.settings.alertAfter = a;
				st.settings.active = wordValue(d, 'Active') !== false;
			} else if ((type === 'Water Source' || type === 'Water Measuring Point') && wordValue(d, 'Source Kind') === 'Unmetered') {
				st.unmetered.push({name: d.Name, what: wordValue(d, 'What It Is') || 'stream / groundwater'});
			} else if (type === 'Water Source' || type === 'Water Measuring Point') {
				var kind = wordValue(d, 'Source Kind'), t2 = {role: type === 'Water Source' ? 'source' : 'measuring', tank: kind === 'Tank'};
				if (wordValue(d, 'Has Sensor') === false || (kind === 'Tank' && wordValue(d, 'Telepathon Pointer') === undefined)) t2.sensorless = true;
				for (var n = 1; n < 20; n++) {
					var mp = wordValue(d, 'Meter ' + n + ' Pointer');
					if (mp === undefined) break;
					var mk = keyOf(mp, chainName);
					if (!mk) continue;
					var r = wordValue(d, 'Meter ' + n + ' Role');
					st.meterRole[mk] = r === 'Physical Sink' ? 'sink' : r === 'Measuring' ? 'measuring' : 'outflow';
					var mn = wordValue(d, 'Meter ' + n + ' Name');
					if (mn) st.meterNames[mk] = mn;
				}
				if (t2.tank) {
					var lp = keyOf(wordValue(d, 'Level Pointer'), chainName);
					t2.level = lp ? lp.split(':')[1] : null;
					t2.levelUnits = wordValue(d, 'Level Units') || null;
					t2.shape = wordValue(d, 'Shape') === 'Cone' ? 'cone' : null;
					t2.area = num(wordValue(d, 'Surface Area')) || 0;
					t2.fullHeight = num(wordValue(d, 'Height When Full')) || 0;
					t2.capacity = num(wordValue(d, 'Capacity')) || 0;
					var kv = num(wordValue(d, 'Known Volume')), ka = parseTime(wordValue(d, 'Known Volume At') || '');
					if (kv !== null && ka !== null) { t2.knownVolume = kv; t2.knownAt = ka; }
					t2.overflowHeight = num(wordValue(d, 'Overflow Height')) || 0;
					t2.overflowWidth = num(wordValue(d, 'Overflow Lip Width')) || 0;
					t2.rainArea = num(wordValue(d, 'Rain Catchment Area')) || 0;
					t2.rainOnSurface = wordValue(d, 'Rain Falls On Surface') === true;
				}
				st.telepathons[d.Name] = t2;
			} else if (type === 'Water Defined Sink') {
				st.sinks.push({name: d.Name, meter: keyOf(wordValue(d, 'Learned On Pointer'), chainName),
					min: num(wordValue(d, 'Minimum Flow')) || 0, max: num(wordValue(d, 'Maximum Flow')) || 0,
					from: wordValue(d, 'Learned From') || '', to: wordValue(d, 'Learned To') || '',
					color: SINK_COLORS[colorIx++ % SINK_COLORS.length]});
			}
		});
		(chain.Denes || []).forEach(function(d) {
			if (d["Dene Type"] !== 'Water Connection') return;
			var a = keyOf(wordValue(d, 'From'), chainName, wordValue(d, 'From Port') === 'Overflow'), b = keyOf(wordValue(d, 'To'), chainName);
			if (a && b) st.conns.push([a, b]);
		});
		return st;
	}

	function toChain(st, teleonomeName, prefix, liveMeters) {
		var chainName = prefix + st.name, T = '@' + teleonomeName;
		function isOver(k) { return / overflow$/.test(k) && !!st.telepathons[k.replace(/ overflow$/, '')]; }
		function ptr(k) {
			if (isOver(k)) return T + ':Purpose:' + chainName + ':' + k.replace(/ overflow$/, '');
			if (k.indexOf(':') > 0) { var p = k.split(':'); return T + ':Telepathons:' + p[0] + ':Purpose:' + p[1]; }
			return T + ':Purpose:' + chainName + ':' + k;
		}
		var denes = [{"Name": "Water Network Settings", "Dene Type": "Water Network Settings", "DeneWords": [
			W("Network Name", st.name, "String"), W("Balance Tolerance", st.settings.tolerance, "double", null, "l/m"),
			W("Minimum Flow", st.settings.minFlow, "double", null, "l/m"), W("Alert After Seconds", st.settings.alertAfter, "int", null, "s"),
			W("Active", st.settings.active !== false, "boolean")]}];
		Object.keys(st.telepathons).forEach(function(name) {
			var t = st.telepathons[name];
			if (t.role === 'none') return;
			var ws = [];
			if (t.role === 'source') ws.push(W("Source Kind", t.tank ? "Tank" : "Telepathon", "String"));
			if (t.sensorless) ws.push(W("Has Sensor", false, "boolean"));
			else ws.push(W("Telepathon Pointer", T + ":Telepathons:" + name, "Dene Pointer"));
			(liveMeters(name) || []).forEach(function(m, ix) {
				var k = name + ':' + m;
				ws.push(W("Meter " + (ix + 1) + " Pointer", ptr(k), "Dene Pointer", "Water Meter Pointer"));
				ws.push(W("Meter " + (ix + 1) + " Role", ROLE_WORDS[st.meterRole[k] || (t.role === 'source' ? 'outflow' : 'measuring')], "String", "Water Meter Role"));
				if (st.meterNames[k]) ws.push(W("Meter " + (ix + 1) + " Name", st.meterNames[k], "String"));
			});
			if (t.tank && t.role === 'source') {
				if (t.shape === 'cone') ws.push(W("Shape", "Cone", "String"));
				if (t.level) { ws.push(W("Level Pointer", T + ":Telepathons:" + name + ":Purpose:" + t.level, "Dene Pointer")); if (t.levelUnits) ws.push(W("Level Units", t.levelUnits, "String")); }
				if (t.area) ws.push(W("Surface Area", t.area, "double", null, "m2"));
				if (t.capacity) ws.push(W("Capacity", t.capacity, "double", null, "L"));
				if (t.knownVolume != null && t.knownAt) { ws.push(W("Known Volume", t.knownVolume, "double", null, "L")); ws.push(W("Known Volume At", stamp(t.knownAt), "String")); }
				if (t.fullHeight) ws.push(W("Height When Full", t.fullHeight, "double", null, "mm"));
				if (t.overflowHeight) { ws.push(W("Overflow Height", t.overflowHeight, "double", null, "mm")); ws.push(W("Overflow Lip Width", t.overflowWidth || 0, "double", null, "m")); }
				if (t.rainArea) { ws.push(W("Rain Catchment Area", t.rainArea, "double", null, "m2")); ws.push(W("Rain Falls On Surface", !!t.rainOnSurface, "boolean")); }
			}
			denes.push({"Name": name, "Dene Type": t.role === 'source' ? "Water Source" : "Water Measuring Point", "DeneWords": ws});
		});
		st.unmetered.forEach(function(u) {
			denes.push({"Name": u.name, "Dene Type": "Water Source", "DeneWords": [W("Source Kind", "Unmetered", "String"), W("What It Is", u.what, "String"), W("Estimated From", "Level Of The Tank It Feeds", "String")]});
		});
		st.sinks.forEach(function(s) {
			denes.push({"Name": s.name, "Dene Type": "Water Defined Sink", "DeneWords": [W("Learned On Pointer", ptr(s.meter), "Dene Pointer", "Water Meter Pointer"),
				W("Minimum Flow", s.min, "double", null, "l/m"), W("Maximum Flow", s.max, "double", null, "l/m"), W("Learned From", s.from || '', "String"), W("Learned To", s.to || '', "String")]});
		});
		var used = {};
		denes.forEach(function(d) { used[d.Name] = true; });
		st.conns.forEach(function(c, ix) {
			var ws = [W("From", ptr(c[0]), "Dene Pointer"), W("To", ptr(c[1]), "Dene Pointer")];
			if (isOver(c[0])) ws.push(W("From Port", "Overflow", "String"));
			var name = 'Pipe ' + (ix + 1) + ' ' + (c[0] + ' To ' + c[1]).replace(/:/g, ' '), n = name, k = 2;
			while (used[n]) n = name + ' ' + (k++);
			used[n] = true;
			denes.push({"Name": n, "Dene Type": "Water Connection", "DeneWords": ws});
		});
		return {"Name": chainName, "Denes": denes};
	}

	// ---------- one network ----------
	function create(o) {
		addStyles();
		var prefix = o.chainPrefix || 'Water Network ';
		var st = o.chain ? fromChain(o.chain, prefix) : emptyState(o.name || 'Water');
		var savedChainName = o.chain ? o.chain.Name : null;
		var editing = !o.chain && !!o.canEdit, dirty = !o.chain, snapshot = o.chain ? JSON.stringify(st) : null;
		var selPort = null, justAdded = null, openChecks = {}, chartKey = null, drag = null, message = '';
		var chartRange = HISTORY_MS, chartView = null;   // the period fetched, and the part of it shown (zoomed) or null
		var history = {};   // "T:word|range" -> {at, data: [{t, v}], pending}
		var NODES = [], PORTS = {}, L = null;
		var root = null;

		// ---- the live telepathons ----
		function liveList() { return (o.telepathons() || []).filter(Boolean); }
		function live(name) { return liveList().filter(function(t) { return t.Name === name; })[0] || null; }
		function purpose(name) { return deneNamed(live(name), 'Purpose'); }
		// A word's units: its own, or (live status packets can come without them) what its name says:
		// "Trough Level" is how full in %, "Measured Height" is cm, "Flow Rate 1" is l/m (2026-11-20).
		function unitsOf(w) {
			if (w && w.Units) return w.Units;
			var n = String((w && w.Name) || '');
			if (/Flow Rate/i.test(n)) return 'l/m';
			if (/Level$/i.test(n) && !/Light/i.test(n)) return '%';
			if (/Measured Height$/i.test(n)) return 'cm';
			return null;
		}
		// a telepathon's flow meters: its Purpose words in l/m (and any the network already names)
		function metersOf(name) {
			var list = [];
			((purpose(name) || {}).DeneWords || []).forEach(function(w) { if (unitsOf(w) === 'l/m') list.push(w.Name); });
			Object.keys(st.meterRole).forEach(function(k) { var p = k.split(':'); if (p[0] === name && list.indexOf(p[1]) < 0) list.push(p[1]); });
			return list;
		}
		function levelWordsOf(name) {
			return ((purpose(name) || {}).DeneWords || []).filter(function(w) { var u = unitsOf(w); return u === '%' || u === 'cm' || u === 'mm'; })
				.map(function(w) { return {name: w.Name, units: unitsOf(w)}; })
				.sort(function(a, b) { return (a.units === '%' ? 0 : 1) - (b.units === '%' ? 0 : 1); });   // how full first
		}
		function typeOf(name) {
			var t = live(name), c = deneNamed(t, 'Configuration');
			return wordValue(c, 'Device Type Id') || wordValue(deneNamed(t, 'Purpose'), 'Device Type Id') || '';
		}
		function secondsOf(name) { var s = num(wordValue(purpose(name), 'Seconds Time')); return s && s > 0 ? s : null; }
		function meterValue(k) { var p = k.split(':'); return num(wordValue(purpose(p[0]), p[1])); }
		function flowValue(k) { var v = meterValue(k); return v === null ? 0 : v; }
		function tel(name) { return st.telepathons[name] || null; }
		function roleOf(name) { var t = tel(name); return t ? t.role : 'none'; }

		// every telepathon that has meters or a level, plus the ones in the network
		function allTelepathonNames() {
			var names = [];
			liveList().forEach(function(t) { if (metersOf(t.Name).length || levelWordsOf(t.Name).length) names.push(t.Name); });
			Object.keys(st.telepathons).forEach(function(n) { if (names.indexOf(n) < 0) names.push(n); });
			return names;
		}

		// ---- a tank's level ----
		function depthMm(name) {
			var t = tel(name);
			if (!t || !t.tank || !t.level) return null;
			var v = num(wordValue(purpose(name), t.level));
			if (v === null) return null;
			var u = t.levelUnits || unitsOf(wordNamed(purpose(name), t.level));
			if (u === '%') return t.fullHeight ? v / 100 * t.fullHeight : null;
			return u === 'cm' ? v * 10 : v;
		}
		function percentOf(name) {
			var t = tel(name), d = depthMm(name);
			if (d !== null && t.fullHeight) return d / t.fullHeight * 100;
			var v = t && t.level ? num(wordValue(purpose(name), t.level)) : null;
			return v !== null && (t.levelUnits || unitsOf(wordNamed(purpose(name), t.level))) === '%' ? v : null;
		}
		// water over the overflow lip, l/m (sharp-crested weir: 1.84 · width · head^1.5 m³/s)
		function overflowNow(name) {
			var t = tel(name), d = depthMm(name);
			if (!t || !t.overflowHeight || d === null) return 0;
			var head = (d - t.overflowHeight) / 1000;
			return head > 0 ? 1.84 * (t.overflowWidth || 0.3) * Math.pow(head, 1.5) * 60000 : 0;
		}

		// ---- keys ----
		function isMeter(k) { return k.indexOf(':') > 0; }
		function isOverflow(k) { return / overflow$/.test(k) && !!tel(k.replace(/ overflow$/, '')); }
		function nodeOf(k) { return isMeter(k) ? k.split(':')[0] : isOverflow(k) ? k.replace(/ overflow$/, '') : k; }
		function sinkNamed(n) { return st.sinks.filter(function(s) { return s.name === n; })[0]; }
		function estNamed(n) { return st.unmetered.filter(function(u) { return u.name === n; })[0]; }
		function meterLabel(k) {
			var p = k.split(':'), nm = st.meterNames[k];
			var ms = metersOf(p[0]), ix = ms.indexOf(p[1]);
			return nm ? nm : ms.length > 1 || /Flow Rate \d/.test(p[1]) ? p[1].replace('Flow Rate', 'Flow') : p[1];
		}
		function epLabel(k) { return isMeter(k) ? nodeOf(k) + ' · ' + meterLabel(k) : isOverflow(k) ? nodeOf(k) + ' · overflow' : k; }
		function children(k) { return st.conns.filter(function(c) { return c[0] === k; }).map(function(c) { return c[1]; }); }
		function sinksOn(k) { return children(k).map(sinkNamed).filter(Boolean); }
		function meterRoleOf(k) { return st.meterRole[k] || (roleOf(nodeOf(k)) === 'source' ? 'outflow' : 'measuring'); }
		function changed() { dirty = true; }

		// which defined sinks explain a reading
		function attribute(v, list) {
			var res = {unexplained: 0, by: {}};
			if (v < st.settings.minFlow) return res;
			if (!list.length) { res.unexplained = v; return res; }
			for (var a = 0; a < list.length; a++) if (v >= list[a].min && v <= list[a].max) { res.by[list[a].name] = v; return res; }
			for (var a2 = 0; a2 < list.length; a2++) for (var b = a2 + 1; b < list.length; b++) {
				var s1 = list[a2], s2 = list[b];
				if (v >= s1.min + s2.min && v <= s1.max + s2.max) { var m1 = (s1.min + s1.max) / 2, m2 = (s2.min + s2.max) / 2; res.by[s1.name] = v * m1 / (m1 + m2); res.by[s2.name] = v * m2 / (m1 + m2); return res; }
			}
			var best = null;
			for (var c = 0; c < list.length; c++) if (v > list[c].max && (!best || list[c].max > best.max)) best = list[c];
			if (best) { res.by[best.name] = best.max; res.unexplained = v - best.max; return res; }
			res.unexplained = v;
			return res;
		}
		function outValue(k) {
			if (isMeter(k)) return flowValue(k);
			if (isOverflow(k)) return overflowNow(nodeOf(k));
			if (estNamed(k)) return estimatedInflow(k);
			return 0;
		}
		// an outlet whose pipes all end at meters: do they add up? Only when they were read close together.
		function junction(k) {
			var kids = children(k).filter(function(c) { return PORTS[c] && PORTS[c]['in']; });
			if (!kids.length || !kids.every(isMeter) || !isMeter(k)) return null;
			// a meter fed from somewhere else too (TopTank's outlet joining the pipe) is shared: no balance to check
			if (kids.some(function(c) { return st.conns.filter(function(x) { return x[1] === c; }).length > 1; })) return null;
			var times = [k].concat(kids).map(function(x) { return secondsOf(nodeOf(x)); });
			if (times.some(function(t) { return t === null; })) return {apart: true, missing: true};
			var spread = Math.max.apply(null, times) - Math.min.apply(null, times);
			if (spread > STALE_APART_SECONDS) return {apart: true, spread: spread};
			var sum = kids.reduce(function(s, c) { return s + flowValue(c); }, 0), diff = outValue(k) - sum;
			return {diff: diff, bad: Math.abs(diff) > st.settings.tolerance, sum: sum};
		}
		// The flow in every pipe at one moment (2026-11-20), from the meters' values then (meter(k) -> l/m):
		//   an outlet with a known flow (a meter, a tank's overflow, a stream worked out from a level) gives first to
		//   the meters it feeds, as much as they show (shared with any other known outlet feeding them); its defined
		//   sinks are recognised in what is left; the rest goes to its other pipes (a tank it fills);
		//   a meter that shows more than its known outlets gave is fed the rest by its other pipes (a tank's outlet:
		//   TopTank draining into the pipe to PipeSplit).
		// Within the balance tolerance counts as nothing, so meters read a few seconds apart do not make flows up.
		// A tank on its own (no meter before or after) gets nothing. Returns one l/m per st.conns entry.
		function solve(meter, known) {
			var flows = st.conns.map(function() { return 0; }), tol = st.settings.tolerance;
			function supplyOf(k) { return isMeter(k) ? meter(k) : known(k); }
			function knownOutlet(k) { return isMeter(k) || isOverflow(k) || !!estNamed(k); }
			var outs = {};
			st.conns.forEach(function(c) { if (knownOutlet(c[0])) outs[c[0]] = true; });
			Object.keys(outs).forEach(function(o) {
				var supply = Math.max(0, supplyOf(o) || 0);
				if (supply <= 0) return;
				var meterKids = [], sinkKids = [], otherKids = [];
				st.conns.forEach(function(c, ix) {
					if (c[0] !== o) return;
					if (isMeter(c[1])) meterKids.push(ix); else if (sinkNamed(c[1])) sinkKids.push(ix); else otherKids.push(ix);
				});
				var wanted = 0;
				meterKids.forEach(function(ix) {
					var b = st.conns[ix][1], others = st.conns.filter(function(x) { return x[1] === b && knownOutlet(x[0]); })
						.reduce(function(sum, x) { return sum + Math.max(0, supplyOf(x[0]) || 0); }, 0);
					flows[ix] = Math.max(0, meter(b) || 0) * (others > 0 ? supply / others : 1);
					wanted += flows[ix];
				});
				if (wanted > supply) { meterKids.forEach(function(ix) { flows[ix] *= supply / wanted; }); wanted = supply; }
				var rest = supply - wanted;
				if (rest <= tol && meterKids.length) return;
				if (sinkKids.length) {
					var at = attribute(rest, sinkKids.map(function(ix) { return sinkNamed(st.conns[ix][1]); }));
					sinkKids.forEach(function(ix) { var v = at.by[st.conns[ix][1]] || 0; flows[ix] = v; rest -= v; });
					if (!otherKids.length) return;
				}
				if (rest > tol && otherKids.length) otherKids.forEach(function(ix) { flows[ix] = rest / otherKids.length; });
			});
			// meters that show more than their known outlets gave: the rest comes from the other pipes into them
			var meters = {};
			st.conns.forEach(function(c) { if (isMeter(c[1])) meters[c[1]] = true; });
			Object.keys(meters).forEach(function(b) {
				var into = [], got = 0;
				st.conns.forEach(function(c, ix) { if (c[1] !== b) return; if (knownOutlet(c[0])) got += flows[ix]; else into.push(ix); });
				var short = Math.max(0, meter(b) || 0) - got;
				if (short > tol && into.length) into.forEach(function(ix) { flows[ix] = short / into.length; });
			});
			return flows;
		}
		var liveFlows = null;
		function flowOn(c) {
			if (!liveFlows) liveFlows = solve(flowValue, function(k) { return isOverflow(k) ? overflowNow(nodeOf(k)) : estNamed(k) ? estimatedInflow(k) : 0; });
			var ix = st.conns.indexOf(c);
			return ix >= 0 ? liveFlows[ix] : 0;
		}

		// ---- a tank without a sensor: what it holds, worked out from the meters since a known volume ----
		// (TopTank, 2026-11-20: Pool's PumpF sees all of Pool's water; what PipeSplit does not take went up to TopTank,
		// what PipeSplit takes beyond PumpF came down from it.) Kept between 0 and its capacity; the litres it would
		// have needed below 0, or held above its capacity, are kept too: either means the start was wrong or water
		// went somewhere the meters do not see.
		var STEP_MS = 30000;
		function rangeFor(ms) { for (var i = 0; i < RANGES.length; i++) if (RANGES[i][1] >= ms) return RANGES[i][1]; return null; }
		function networkMeters() { var list = []; st.conns.forEach(function(c) { [c[0], c[1]].forEach(function(k) { if (isMeter(k) && list.indexOf(k) < 0) list.push(k); }); }); return list; }
		// every pipe's flow every 30 s from t0 to now, from the meters' history: [{t, flows}] or null while it is read
		var timelineCache = {};
		function timeline(t0) {
			var c = timelineCache[t0];
			if (c && Date.now() - c.at < 30000) return c.result;
			var result = timelineNow(t0);
			if (result) timelineCache[t0] = {at: Date.now(), result: result};
			return result;
		}
		var STALE_READING_MS = 10 * 60000;   // a meter that stopped reporting counts as still, not as its last value
		function timelineNow(t0) {
			var now = Date.now(), range = rangeFor(now - t0 + 120000);
			if (!range) return {tooOld: true};
			var keys = networkMeters(), data = {}, missing = false;
			keys.forEach(function(k) { var d = wantHistory(k, range); if (!d) missing = true; data[k] = d || []; });
			if (missing) return null;
			var cursor = {}, out = [];
			keys.forEach(function(k) { cursor[k] = 0; });
			function at(k, t) {
				var d = data[k], i = cursor[k];
				while (i + 1 < d.length && d[i + 1].t <= t) i++;
				cursor[k] = i;
				return d.length && d[i].t <= t && t - d[i].t < STALE_READING_MS ? d[i].v : 0;
			}
			for (var t = t0; t <= now; t += STEP_MS) {
				var tt = t;
				out.push({t: t, flows: solve(function(k) { return at(k, tt); }, function() { return 0; })});
			}
			return {steps: out};
		}
		function tankEstimate(name) {
			var t = tel(name);
			if (!t || t.level || t.knownVolume == null || !t.knownAt) return null;
			var tl = timeline(t.knownAt);
			if (!tl) return {waiting: true};
			if (tl.tooOld) return {tooOld: true};
			var v = t.knownVolume, cap = t.capacity || Infinity, inL = 0, outL = 0, overL = 0, shortL = 0;
			tl.steps.forEach(function(step) {
				var fin = 0, fout = 0;
				st.conns.forEach(function(c, ix) { if (c[1] === name) fin += step.flows[ix]; if (c[0] === name) fout += step.flows[ix]; });
				var dIn = fin * STEP_MS / 60000, dOut = fout * STEP_MS / 60000;
				inL += dIn; outL += dOut;
				v += dIn;
				if (v > cap) { overL += v - cap; v = cap; }
				if (dOut > v) { shortL += dOut - v; v = 0; } else v -= dOut;
			});
			return {volume: v, inL: inL, outL: outL, overL: overL, shortL: shortL, since: t.knownAt};
		}

		// ---- tank balances from the last hour (DeviceViewsHost.fetchHistory), refreshed every minute ----
		function wantHistory(k, range) {
			range = range || HISTORY_MS;
			var hk = k + '|' + range, h = history[hk];
			// a longer period changes slowly: fetched again every 5 minutes, the last hour every minute
			if (h && (h.pending || Date.now() - h.at < (range > HISTORY_MS ? 300000 : 60000))) return h.data;
			if (typeof DeviceViewsHost === 'undefined') return h ? h.data : null;
			var p = k.split(':');
			history[hk] = {at: Date.now(), data: h ? h.data : null, pending: true};
			DeviceViewsHost.fetchHistory({telepathon: p[0], dene: 'Purpose', deneWord: p[1], range: range}, function(data) {
				var list = (data || []).map(function(r) { return {t: parseTime(r.timeString), v: num(r.Value)}; })
					.filter(function(r) { return r.t !== null && r.v !== null; }).sort(function(a, b) { return a.t - b.t; });
				history[hk] = {at: Date.now(), data: list, pending: false};
				if (root && root.parentNode) drawLive();
			});
			return h ? h.data : null;
		}
		// litres through a meter between t0 and t1 (each reading holds until the next)
		function litres(data, t0, t1) {
			if (!data || !data.length) return 0;
			var total = 0;
			for (var i = 0; i < data.length; i++) {
				var a = Math.max(t0, data[i].t), b = Math.min(t1, i + 1 < data.length ? data[i + 1].t : t1);
				if (b > a) total += data[i].v * (b - a) / 60000;
			}
			return total;
		}
		// unmetered water into a tank over the last hour: rise × area + pumped out − pumped in − overflow
		function tankBalance(name) {
			var t = tel(name);
			if (!t || !t.tank || !t.level || !(t.area || t.capacity)) return null;
			var units = t.levelUnits || unitsOf(wordNamed(purpose(name), t.level));
			// litres in the tank for a level reading: % × capacity, else the depth × the surface area
			var byCapacity = units === '%' && t.capacity > 0;
			if (!byCapacity && !t.area) return null;
			if (units === '%' && !byCapacity && !t.fullHeight) return {needsFull: true};
			var lv = wantHistory(name + ':' + t.level);
			if (!lv || lv.length < 6) return {waiting: true};
			function mm(v) { return units === '%' ? v / 100 * (t.fullHeight || 0) : units === 'cm' ? v * 10 : v; }
			function vol(v) { return byCapacity ? v / 100 * t.capacity : mm(v) * t.area; }
			var k = Math.min(3, Math.floor(lv.length / 3)), first = lv.slice(0, k), last = lv.slice(-k);
			var h1 = avg(first.map(function(r) { return mm(r.v); })), h2 = avg(last.map(function(r) { return mm(r.v); }));
			var v1 = avg(first.map(function(r) { return vol(r.v); })), v2 = avg(last.map(function(r) { return vol(r.v); }));
			var t0 = avg(first.map(function(r) { return r.t; })), t1 = avg(last.map(function(r) { return r.t; }));
			var inL = 0, outL = 0, missing = false;
			st.conns.forEach(function(c) {
				if (c[1] === name && isMeter(c[0])) { var d = wantHistory(c[0]); if (!d) missing = true; inL += litres(d, t0, t1); }
				if (nodeOf(c[0]) === name && isMeter(c[0]) && meterRoleOf(c[0]) !== 'measuring') { var d2 = wantHistory(c[0]); if (!d2) missing = true; outL += litres(d2, t0, t1); }
			});
			// the outflow meters of the tank itself count even when no pipe is laid yet
			metersOf(name).forEach(function(m) {
				var mk = name + ':' + m;
				if (meterRoleOf(mk) === 'outflow' && !st.conns.some(function(c) { return c[0] === mk; })) { var d3 = wantHistory(mk); if (!d3) missing = true; outL += litres(d3, t0, t1); }
			});
			var minutes = (t1 - t0) / 60000, rise = h2 - h1, riseL = v2 - v1, unmetered = riseL + outL - inL;
			var step = units === '%' ? (t.fullHeight || 0) / 100 : units === 'cm' ? 10 : 1;
			return {minutes: minutes, rise: rise, riseL: riseL, byCapacity: byCapacity, inL: inL, outL: outL, unmetered: unmetered, perMinute: minutes > 0 ? unmetered / minutes : 0,
				resolutionL: byCapacity ? t.capacity / 100 : step * t.area, resolutionMm: step, missing: missing};
		}
		// what went into a tank through metered pipes over the last hour (a tank without a sensor: all we know)
		function filledLastHour(name) {
			if (!st.conns.some(function(c) { return c[1] === name; })) return null;
			var tl = timeline(Date.now() - HISTORY_MS);
			if (!tl || tl.tooOld) return undefined;
			var total = 0;
			tl.steps.forEach(function(step) { st.conns.forEach(function(c, ix) { if (c[1] === name) total += step.flows[ix] * STEP_MS / 60000; }); });
			return total;
		}
		function estimatedInflow(name) {
			var c = st.conns.filter(function(x) { return x[0] === name; })[0];
			if (!c) return 0;
			var b = tankBalance(c[1]);
			return b && b.perMinute > 0 && b.unmetered > b.resolutionL ? b.perMinute : 0;
		}

		// ---- nodes, ports and layout (as in the mockup) ----
		function buildNodes() {
			var ns = [];
			allTelepathonNames().forEach(function(name) {
				var t = tel(name);
				if (!t || t.role === 'none') return;
				var ms = metersOf(name);
				var n = {id: name, kind: t.role === 'source' ? (t.tank ? 'tank' : 'src') : 'mp', t: t, ports: []};
				if (t.tank && ms.length) n.ports.push({key: name, meter: false, inp: true, out: false});
				if (t.tank && t.overflowHeight) n.ports.push({key: name + ' overflow', meter: false, inp: false, out: true, overflow: true});
				if (ms.length) ms.forEach(function(m) { var k = name + ':' + m, r = meterRoleOf(k); n.ports.push({key: k, meter: true, inp: r !== 'outflow', out: r !== 'sink', role: r}); });
				else n.ports.push({key: name, meter: false, inp: t.role !== 'source' || !!t.tank, out: true});
				ns.push(n);
			});
			st.unmetered.forEach(function(u) { ns.push({id: u.name, kind: 'est', u: u, ports: [{key: u.name, meter: false, inp: false, out: true}]}); });
			st.sinks.forEach(function(s) { ns.push({id: s.name, kind: 'dsink', s: s, ports: [{key: s.name, meter: false, inp: true, out: false}]}); });
			return ns;
		}

		function layout(narrow) {
			NODES = buildNodes();
			var byId = {};
			NODES.forEach(function(n) { byId[n.id] = n; n.rank = 0; n.parents = []; n.kids = []; });
			var edges = st.conns.filter(function(c) { return byId[nodeOf(c[0])] && byId[nodeOf(c[1])] && nodeOf(c[0]) !== nodeOf(c[1]) && !isOverflow(c[0]); });
			edges.forEach(function(c) { var a = byId[nodeOf(c[0])], b = byId[nodeOf(c[1])]; a.kids.push(b); b.parents.push(a); });
			for (var it = 0; it < NODES.length; it++) edges.forEach(function(c) { var a = byId[nodeOf(c[0])], b = byId[nodeOf(c[1])]; if (b.rank < a.rank + 1) b.rank = Math.min(a.rank + 1, 8); });
			NODES.forEach(function(n) { if (!n.parents.length && n.kids.length) n.rank = Math.max(0, Math.min.apply(null, n.kids.map(function(k) { return k.rank; })) - 1); });
			NODES.forEach(function(n) { n.shelf = !n.parents.length && !n.kids.length; });
			var inNet = NODES.filter(function(n) { return !n.shelf; }), shelf = NODES.filter(function(n) { return n.shelf; });
			var maxRank = Math.max.apply(null, inNet.map(function(n) { return n.rank; }).concat([1]));
			var ranks = [];
			for (var r = 0; r <= maxRank; r++) ranks.push([]);
			inNet.forEach(function(n) { ranks[n.rank].push(n); });
			var W, H;
			NODES.forEach(function(n) {
				var m = n.ports.filter(function(p) { return p.meter; }).length;
				n.mTop = n.kind === 'tank' ? 118 : 46;
				if (!narrow) { n.w = 190; n.h = n.kind === 'tank' ? (m ? 122 + m * 50 : 130) : n.kind === 'dsink' || n.kind === 'est' ? 80 : 50 + Math.max(1, m) * 50; }
				else n.h = n.kind === 'tank' ? (m ? 182 : 132) : n.kind === 'dsink' || n.kind === 'est' ? 86 : (m ? 104 : 80);
			});
			function meterY(pn, key) { var ms = pn.ports.filter(function(q) { return q.meter; }), ix = ms.map(function(q) { return q.key; }).indexOf(key); return ix >= 0 ? pn.y + pn.mTop + ix * 50 + 30 : pn.y + pn.h / 2; }
			function meterX(pn, key) { var ms = pn.ports.filter(function(q) { return q.meter; }), ix = ms.map(function(q) { return q.key; }).indexOf(key); return ix >= 0 ? pn.x + (ix + 0.5) * pn.w / ms.length : pn.x + pn.w / 2; }
			if (!narrow) {
				W = Math.max(1000, 230 + maxRank * 250);
				var colGap = maxRank ? (W - 40 - 190) / maxRank : 0, tallest = 0;
				ranks.forEach(function(list, r) {
					list.forEach(function(n) { var ys = edges.filter(function(c) { return nodeOf(c[1]) === n.id && byId[nodeOf(c[0])].y !== undefined; }).map(function(c) { return meterY(byId[nodeOf(c[0])], c[0]); }); n.key = ys.length ? avg(ys) : 1e6; });
					list.sort(function(a, b) { return a.key - b.key; });
					var y = 44;
					list.forEach(function(n) { n.x = 20 + r * colGap + (190 - n.w) / 2; n.y = y; y += n.h + 34; });
					tallest = Math.max(tallest, y - 34 - 20);
				});
				H = inNet.length ? tallest + 40 : 40;
				ranks.forEach(function(list) { var tot = list.reduce(function(s, n) { return s + n.h; }, 0) + (list.length - 1) * 34, off = (H - 40 - tot) / 2; list.forEach(function(n) { n.y += off; }); });
			} else {
				W = 400;
				var y = 14;
				ranks.forEach(function(list) {
					list.forEach(function(n) { var xs = edges.filter(function(c) { return nodeOf(c[1]) === n.id && byId[nodeOf(c[0])].x !== undefined; }).map(function(c) { return meterX(byId[nodeOf(c[0])], c[0]); }); n.key = xs.length ? avg(xs) : 1e6; });
					list.sort(function(a, b) { return a.key - b.key; });
					var gap = 10, avail = W - 16 - (list.length - 1) * gap;
					var want = list.map(function(n) { return n.ports.filter(function(p) { return p.meter; }).length > 1 ? 2.2 : 1; });
					var tw = want.reduce(function(s, x) { return s + x; }, 0), rowH = 0;
					list.forEach(function(n, ix) { n.w = Math.min(want[ix] > 1 ? 320 : 220, avail * want[ix] / tw); });
					var used = list.reduce(function(s, n) { return s + n.w; }, 0) + (list.length - 1) * gap, x = (W - used) / 2;
					list.forEach(function(n) { n.x = x; n.y = y; x += n.w + gap; rowH = Math.max(rowH, n.h); });
					y += rowH + 78;
				});
				H = inNet.length ? y - 64 : 20;
			}
			var shelfTop = null;
			if (shelf.length) {
				shelfTop = H + 14;
				var sx = narrow ? 8 : 20, sy = shelfTop + 50, rowH2 = 0, sw = narrow ? (W - 16 - 10) / 2 : 190, sgap = narrow ? 10 : 40;
				shelf.forEach(function(n) {
					n.w = sw;
					if (sx + n.w > W - 8) { sx = narrow ? 8 : 20; sy += rowH2 + 26; rowH2 = 0; }
					n.x = sx; n.y = sy; sx += n.w + sgap; rowH2 = Math.max(rowH2, n.h);
				});
				H = sy + rowH2 + 16;
			}
			PORTS = {};
			NODES.forEach(function(n) {
				var ms = n.ports.filter(function(p) { return p.meter; });
				n.ports.forEach(function(p) {
					var ix = ms.indexOf(p), inp, out;
					if (p.overflow) { inp = null; out = narrow ? [n.x + n.w - 14, n.y + n.h] : [n.x + n.w, n.y + 52]; }
					else if (!narrow) { var py = p.meter ? n.y + n.mTop + ix * 50 + 30 : (n.kind === 'tank' && ms.length ? n.y + 70 : n.y + n.h / 2); inp = [n.x, py]; out = [n.x + n.w, py]; }
					else { var px = p.meter ? n.x + (ix + 0.5) * n.w / ms.length : (n.kind === 'tank' && ms.length ? n.x + 24 : n.x + n.w / 2); inp = [px, n.y]; out = [px, n.y + n.h]; }
					PORTS[p.key] = {node: n, p: p, 'in': p.inp ? inp : null, out: p.out ? out : null};
				});
			});
			var topY = Math.min.apply(null, inNet.map(function(n) { return n.y; }).concat([40])) - 20;
			return {W: W, H: shelfTop === null ? Math.max(H, narrow ? 200 : 160) : H, narrow: narrow, shelfTop: shelfTop, topY: topY};
		}

		function pathFor(a, b, narrow, back) {
			if (back && !narrow) return 'M' + a[0] + ' ' + a[1] + ' H' + (a[0] + 18) + ' V' + L.topY + ' H' + (b[0] - 18) + ' V' + b[1] + ' H' + b[0];
			if (back) return 'M' + a[0] + ' ' + a[1] + ' V' + (a[1] + 16) + ' H' + (L.W - 4) + ' V' + (b[1] - 16) + ' H' + b[0] + ' V' + b[1];
			if (!narrow) { var mx = a[0] + Math.max(24, (b[0] - a[0]) / 2); return 'M' + a[0] + ' ' + a[1] + ' H' + mx + ' V' + b[1] + ' H' + b[0]; }
			var my = a[1] + Math.max(24, (b[1] - a[1]) / 2);
			return 'M' + a[0] + ' ' + a[1] + ' V' + my + ' H' + b[0] + ' V' + b[1];
		}
		function badge(g, x, y, text, cls) {
			var b = S('g', {'class': 'badge ' + cls}, g), w = 14 + text.length * 6.6;
			S('rect', {x: x - w / 2, y: y - 11, width: w, height: 22, rx: 11}, b);
			S('text', {x: x, y: y + 4, 'text-anchor': 'middle'}, b, text);
		}

		// ---------- the page ----------
		var parts = {};
		function render() {
			o.view.textContent = '';
			root = el('div', 'dvw');
			var head = el('div', 'dvw-head');
			head.appendChild(el('h2', null, st.name));
			if (o.canEdit) {
				var eb = el('button', 'btn btn-default btn-sm', editing ? 'Done' : 'Edit network');
				eb.type = 'button';
				eb.addEventListener('click', function() {
					if (editing && dirty && savedChainName) { if (!window.confirm('Leave without saving? Your changes are kept until you press Discard.')) return; }
					editing = !editing; selPort = null;
					if (editing && !snapshot) snapshot = JSON.stringify(st);
					render();
				});
				head.appendChild(eb);
			}
			if (o.sync) {
				var sync = el('span'), sb = el('button', 'btn btn-default btn-sm', o.sync.label), ss = el('span', 'muted');
				sb.type = 'button'; ss.style.marginLeft = '8px'; ss.style.fontSize = '12px';
				sync.appendChild(sb); sync.appendChild(ss);
				function said(text) { ss.textContent = text || ''; }
				o.sync.status().then(said, function() { said(''); });
				sb.addEventListener('click', function() {
					sb.disabled = true; said('Asking…');
					o.sync.send().then(said, function(err) { said(err && err.message ? err.message : String(err)); }).then(function() { sb.disabled = false; });
				});
				head.insertBefore(sync, head.children[1] || null);
			}
			root.appendChild(head);
			if (o.note) root.appendChild(el('p', 'muted', o.note));
			var card = el('div', 'dvw-card'), grid = el('div', 'dvw-grid'), left = el('div'), right = el('div');
			parts.hint = el('div', 'dvw-hint'); parts.net = el('div'); parts.tray = el('div', 'dvw-tray');
			left.appendChild(parts.hint); left.appendChild(parts.net); left.appendChild(parts.tray);
			parts.checks = el('div', 'dvw-checks');
			right.appendChild(parts.checks);
			grid.appendChild(left); grid.appendChild(right); card.appendChild(grid); root.appendChild(card);

			var cc = el('div', 'dvw-card'), ch = el('div', 'dvw-head'), row = el('div');
			row.style.display = 'flex'; row.style.gap = '8px'; row.style.alignItems = 'center'; row.style.flexWrap = 'wrap';
			parts.chartRange = el('select', 'form-control input-sm');
			parts.chartRange.style.width = 'auto';
			parts.chartRange.setAttribute('aria-label', 'Period to chart');
			RANGES.forEach(function(r) { var op = el('option', null, r[0]); op.value = String(r[1]); if (r[1] === chartRange) op.selected = true; parts.chartRange.appendChild(op); });
			parts.chartRange.addEventListener('change', function() { chartRange = +parts.chartRange.value; chartView = null; drawChart(); });
			row.appendChild(parts.chartRange);
			parts.chartMeter = el('select', 'form-control input-sm');
			parts.chartMeter.style.width = 'auto';
			parts.chartMeter.setAttribute('aria-label', 'Meter to chart');
			parts.chartMeter.addEventListener('change', function() { chartKey = parts.chartMeter.value; drawChart(); });
			row.appendChild(parts.chartMeter);
			// zoom and move: a drag zooms in to what it covers; these step out and along
			parts.zoomBar = el('span');
			parts.zoomBar.style.display = 'inline-flex'; parts.zoomBar.style.gap = '4px'; parts.zoomBar.style.flexWrap = 'wrap';
			function zbtn(label, title, fn) { var b = el('button', 'btn btn-default btn-sm', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); parts.zoomBar.appendChild(b); return b; }
			zbtn('◀', 'Earlier', function() { pan(-0.5); });
			zbtn('−', 'Zoom out a step', function() { zoomBy(2); });
			zbtn('▶', 'Later', function() { pan(0.5); });
			zbtn('Whole period', 'Show the whole period', function() { chartView = null; drawChart(); });
			row.appendChild(parts.zoomBar);
			ch.appendChild(row);
			ch.appendChild(el('span', 'muted', 'Drag across the chart to zoom in; again to zoom in more'));
			cc.appendChild(ch);
			parts.chart = S('svg', {'class': 'dvw-chart', viewBox: '0 0 1000 260', 'aria-label': 'Flow chart'});
			cc.appendChild(parts.chart);
			parts.legend = el('div', 'dvw-legend');
			cc.appendChild(parts.legend);
			if (o.canEdit) {
				var nb = el('div');
				nb.style.marginTop = '8px';
				parts.nameShown = el('button', 'btn btn-primary btn-sm', 'Name a defined sink from what is shown');
				parts.nameShown.type = 'button';
				parts.nameShown.addEventListener('click', function() { newSinkSheet(parts.t0, parts.t1); });
				nb.appendChild(parts.nameShown);
				nb.appendChild(el('span', 'muted', '  zoom in until the chart shows only the run you want to name'));
				cc.appendChild(nb);
			}
			root.appendChild(cc);
			chartEvents();

			if (editing) root.appendChild(saveBar());
			o.view.appendChild(root);
			drawLive();
		}

		function drawLive() {
			if (!root) return;
			liveFlows = null;
			drawNet(); drawChecks(); drawChart();
		}

		function drawNet() {
			var box = parts.net, narrow = (o.view.clientWidth || 1000) < 620;
			L = layout(narrow);
			box.textContent = '';
			var svg = S('svg', {'class': 'dvw-net' + (editing ? ' editing' : ''), viewBox: '0 0 ' + L.W + ' ' + L.H, role: 'img', 'aria-label': 'Water network diagram'});
			box.appendChild(svg);
			var gs = S('g', {}, svg), gp = S('g', {}, svg), gn = S('g', {}, svg), gb = S('g', {}, svg), gpt = S('g', {}, svg);
			if (!NODES.length) S('text', {x: 20, y: 40, fill: 'var(--wmuted)', 'font-size': 15}, gs, editing ? 'Empty. Add sources and measuring points from the list under the diagram.' : 'This network is empty.' + (o.canEdit ? ' Press Edit network.' : ''));
			if (L.shelfTop !== null) {
				S('line', {x1: 8, x2: L.W - 8, y1: L.shelfTop, y2: L.shelfTop, stroke: 'var(--wline)', 'stroke-width': 2, 'stroke-dasharray': '8 6'}, gs);
				S('rect', {x: 8, y: L.shelfTop + 6, width: L.W - 16, height: L.H - L.shelfTop - 10, rx: 10, fill: 'var(--wtile)'}, gs);
				S('text', {x: 20, y: L.shelfTop + 26, 'font-size': 13, 'font-weight': 700, fill: 'var(--wmuted)'}, gs, editing ? 'Not connected: lay a pipe from or to these' : 'Not connected');
			}
			var FS = narrow ? {name: 15, sub: 12, val: 18, lab: 12} : {name: 16, sub: 13, val: 19, lab: 12};

			st.conns.forEach(function(c, ix) {
				var A = PORTS[c[0]], B = PORTS[c[1]];
				if (!A || !B || !A.out || !B['in']) return;
				var back = isOverflow(c[0]) || (narrow ? B['in'][1] <= A.out[1] : B['in'][0] <= A.out[0]);
				var d = pathFor(A.out, B['in'], narrow, back), flow = flowOn(c), j = junction(c[0]);
				var bed = S('path', {d: d, 'class': 'pipe bed', 'stroke-width': 10}, gp);
				if (flow > 0.05) {
					var w = Math.min(14, 3 + Math.sqrt(flow) * 1.4), dur = Math.max(0.25, 3.2 / Math.sqrt(flow + 0.3));
					S('path', {d: d, 'class': 'pipe flow' + (j && j.bad ? ' bad' : ''), 'stroke-width': w, style: 'animation-duration:' + dur.toFixed(2) + 's;pointer-events:none'}, gp);
				}
				var hit = S('path', {d: d, 'class': 'pipe hit'}, gp);
				hit.addEventListener('click', function() { if (editing) pipeSheet(ix); });
				hit.addEventListener('mouseenter', function() { if (editing) bed.classList.add('hl'); });
				hit.addEventListener('mouseleave', function() { bed.classList.remove('hl'); });
			});

			NODES.forEach(function(n) {
				var cls = {src: 'src', tank: 'src', mp: 'mp', dsink: 'dsink', est: 'est'}[n.kind];
				if (n.kind === 'dsink' && !n.parents.length) cls += ' loose';
				var g = S('g', {'class': 'node ' + cls}, gn);
				var x = n.x, y = n.y, w = n.w, h = n.h, cx = x + w / 2;
				S('rect', {x: x, y: y, width: w, height: h, rx: 10, 'class': 'box'}, g);
				if (editing && justAdded === n.id) S('rect', {x: x - 5, y: y - 5, width: w + 10, height: h + 10, rx: 13, fill: 'none', stroke: 'var(--wsel)', 'stroke-width': 3, 'stroke-dasharray': '6 4'}, g);
				var anchor = narrow ? 'middle' : 'start', tx = narrow ? cx : x + 12;
				function txt(yy, s, cl, size) { S('text', {x: tx, y: yy, 'text-anchor': anchor, 'class': cl, 'font-size': size}, g, s); }
				function meters(top) {
					var ms = n.ports.filter(function(p) { return p.meter; });
					ms.forEach(function(p, ix) {
						var v = meterValue(p.key), lab = meterLabel(p.key) + (p.role === 'outflow' ? ' · out' : p.role === 'sink' ? ' · leaves' : '');
						if (!narrow) { var yy = y + top + ix * 50; S('text', {x: x + 12, y: yy + 18, 'class': 't-sub', 'font-size': FS.lab}, g, lab); S('text', {x: x + 12, y: yy + 40, 'class': 't-val', 'font-size': FS.val}, g, f(v) + ' l/m'); }
						else { var mx = x + (ix + 0.5) * w / ms.length; S('text', {x: mx, y: y + h - 44, 'text-anchor': 'middle', 'class': 't-sub', 'font-size': FS.lab}, g, lab); S('text', {x: mx, y: y + h - 20, 'text-anchor': 'middle', 'class': 't-val', 'font-size': FS.val}, g, f(v) + ' l/m'); }
					});
					return ms.length;
				}
				var noData = (n.kind === 'src' || n.kind === 'mp' || n.kind === 'tank') && !live(n.id) && !(n.t && n.t.sensorless);
				if (n.kind === 'src' || n.kind === 'mp') {
					txt(y + 22, n.id, 't-name', FS.name);
					txt(y + 39, noData ? 'no data from it' : n.kind === 'src' ? 'Source' : 'Measuring point', 't-sub', FS.sub);
					if (!meters(46)) txt(y + 62, typeOf(n.id), 't-sub', FS.sub);
				} else if (n.kind === 'tank') {
					var t = n.t, hasM = n.ports.some(function(p) { return p.meter; });
					txt(y + 22, n.id, 't-name', FS.name);
					txt(y + 39, noData ? 'no data from it' : t.sensorless && !live(n.id) ? 'Source · tank, no sensor' : t.shape === 'cone' ? 'Source · tank (cone)' : 'Source · tank', 't-sub', FS.sub);
					var d = depthMm(n.id), pc = percentOf(n.id), lvl = pc === null ? 0 : pc / 100, big, small = '';
					var est = !t.level ? tankEstimate(n.id) : null;
					if (est && est.volume != null) {
						big = '≈ ' + Math.round(est.volume).toLocaleString() + ' L';
						small = (t.capacity ? 'of ' + Math.round(t.capacity).toLocaleString() + ' L · ' : '') + 'estimated';
						if (t.capacity) lvl = est.volume / t.capacity;
					} else if (!t.level) {
						var fl1 = filledLastHour(n.id);
						big = t.capacity ? Math.round(t.capacity).toLocaleString() + ' L' : 'level ?';
						small = fl1 ? '+' + Math.round(fl1).toLocaleString() + ' L last hour' : t.sensorless && !live(n.id) ? 'no sensor yet' : 'no level chosen';
					}
					else if (pc !== null && t.capacity) { big = pc.toFixed(0) + ' %'; small = Math.round(pc / 100 * t.capacity).toLocaleString() + ' of ' + Math.round(t.capacity).toLocaleString() + ' L'; }
					else if (d !== null && t.area) { big = (d / 1000).toFixed(2) + ' m'; small = Math.round(d * t.area).toLocaleString() + ' L' + (pc !== null ? ' · ' + pc.toFixed(0) + ' %' : ''); }
					else if (pc !== null) big = pc.toFixed(0) + ' %';
					else big = '—';
					var bx = narrow ? Math.max(x + 8, cx - 60) : x + 12, by = y + 50, lv = Math.max(0, Math.min(1, lvl)), ov = overflowNow(n.id);
					if (t.shape !== 'cone') S('rect', {x: bx, y: by + (1 - lv) * 60, width: 44, height: lv * 60, 'class': 'tankfill'}, g);
					if (ov > 0.5) {
						S('path', {d: 'M' + (bx + 44) + ' ' + (by + 2) + ' q8 -6 12 6 v16', fill: 'none', stroke: 'var(--wwater)', 'stroke-width': 3, 'stroke-linecap': 'round'}, g);
						S('rect', {x: x + 1, y: y + 28, width: w - 2, height: 16, fill: 'var(--wbg)'}, g);
						S('text', {x: tx, y: y + 40, 'text-anchor': anchor, 'font-size': FS.sub, 'font-weight': 700, fill: 'var(--wbad)'}, g, 'overflowing ≈ ' + f(ov) + ' l/m');
					}
					if (t.shape === 'cone') S('path', {d: 'M' + bx + ' ' + by + ' H' + (bx + 44) + ' L' + (bx + 22) + ' ' + (by + 56) + ' Z', 'class': 'tankline', 'stroke-dasharray': t.level ? 'none' : '4 3'}, g);
					else S('rect', {x: bx, y: by, width: 44, height: 60, 'class': 'tankline'}, g);
					var inflow = st.conns.filter(function(c) { return c[1] === n.id; }).reduce(function(s, c) { return s + flowOn(c); }, 0);
					S('text', {x: bx + 54, y: by + 20, 'class': 't-val', 'font-size': FS.val}, g, big);
					if (small) S('text', {x: bx + 54, y: by + 38, 'class': 't-sub', 'font-size': FS.sub}, g, small);
					S('text', {x: bx + 54, y: by + (small ? 56 : 40), 'class': 't-sub', 'font-size': FS.sub}, g, 'in ' + f(inflow) + ' l/m');
					if (t.rainArea && !(narrow && w < 170)) {
						var cg = S('g', {'class': 'cloud'}, g), ox = x + w - 50, oy = y + 6;
						S('path', {d: 'M' + (ox + 8) + ' ' + (oy + 26) + ' a9 9 0 0 1 2-17 a12 12 0 0 1 22-3 a9 9 0 0 1 8 20 z'}, cg);
						S('text', {x: ox + 21, y: oy + 40, 'text-anchor': 'middle'}, cg, 'rain');
					}
					if (hasM) meters(n.mTop);
				} else if (n.kind === 'est') {
					var ev = estimatedInflow(n.id);
					txt(y + 22, n.id, 't-name', FS.name);
					txt(y + 40, 'Source · no meter', 't-sub', FS.sub);
					txt(y + 66, ev > 0.05 ? '≈ ' + f(ev) + ' l/m' : '≈ 0', ev > 0.05 ? 't-val' : 't-sub', ev > 0.05 ? FS.val : FS.sub);
				} else {
					var fl = st.conns.filter(function(c) { return c[1] === n.id; }).reduce(function(s, c) { return s + flowOn(c); }, 0);
					if (fl > 0.05) g.classList.add('active');
					var words = n.id.split(' ');
					if (narrow && w < 150 && words.length > 1) { txt(y + 20, words[0], 't-name', 14); txt(y + 37, words.slice(1).join(' '), 't-name', 14); txt(y + 54, n.parents.length ? 'Defined sink' : 'not connected', 't-sub', FS.sub); txt(y + 76, fl > 0.05 ? f(fl) + ' l/m' : 'off', fl > 0.05 ? 't-val' : 't-sub', fl > 0.05 ? FS.val : FS.sub); }
					else { txt(y + 22, n.id, 't-name', FS.name); txt(y + 40, n.parents.length ? 'Defined sink' : 'Defined sink · not connected', 't-sub', FS.sub); txt(y + 66, fl > 0.05 ? f(fl) + ' l/m' : 'off', fl > 0.05 ? 't-val' : 't-sub', fl > 0.05 ? FS.val : FS.sub); }
				}
				g.addEventListener('click', function() { if (editing) nodeSheet(n.id); });
			});

			Object.keys(PORTS).forEach(function(k) {
				var P = PORTS[k];
				if (!P.out) return;
				var kids = children(k).filter(function(c) { return PORTS[c] && PORTS[c]['in']; });
				if (!kids.length) return;
				var j = junction(k), firstIn = PORTS[kids[0]]['in'], bx, by;
				if (!narrow) { bx = P.out[0] + Math.max(24, (firstIn[0] - P.out[0]) / 2) / 2 + 4; by = P.out[1] - 20; }
				else { bx = P.out[0] + 44; by = P.out[1] + Math.max(24, (firstIn[1] - P.out[1]) / 2) / 2; }
				if (j && j.apart) { if (outValue(k) > 0.05) badge(gb, bx, by, 'not compared', 'warn'); }
				else if (j) { if (outValue(k) > 0.05 || j.bad) badge(gb, bx, by, j.bad ? 'lost ' + j.diff.toFixed(1) : 'balanced', j.bad ? 'bad' : 'ok'); }
				else if (sinksOn(k).length && outValue(k) > 0.05) { var at = attribute(outValue(k), sinksOn(k)); badge(gb, bx, by, at.unexplained > 0.05 ? '? ' + at.unexplained.toFixed(1) : 'explained', at.unexplained > 0.05 ? 'bad' : 'ok'); }
			});

			Object.keys(PORTS).forEach(function(k) {
				var P = PORTS[k];
				['in', 'out'].forEach(function(dir) {
					var xy = P[dir];
					if (!xy) return;
					if (!editing && !st.conns.some(function(c) { return dir === 'out' ? c[0] === k : c[1] === k; })) return;
					var cls = 'port ' + dir;
					if (editing && selPort === k && dir === 'out') cls += ' sel';
					if (editing && selPort && dir === 'in' && nodeOf(selPort) !== nodeOf(k) && !st.conns.some(function(c) { return c[0] === selPort && c[1] === k; })) cls += ' target';
					S('circle', {cx: xy[0], cy: xy[1], r: editing ? 9 : 6, 'class': cls}, gpt);
					if (editing) {
						var hc = S('circle', {cx: xy[0], cy: xy[1], r: 18, fill: 'transparent', style: 'cursor:pointer'}, gpt);
						hc.addEventListener('click', function(ev) { ev.stopPropagation(); portTap(k, dir); });
					}
				});
			});
			drawHintAndTray();
		}

		// ---------- editing in the diagram ----------
		function portTap(k, dir) {
			if (dir === 'out') { selPort = selPort === k ? null : k; return drawNet(); }
			if (!selPort || nodeOf(selPort) === nodeOf(k)) return;
			if (!st.conns.some(function(c) { return c[0] === selPort && c[1] === k; })) {
				st.conns.push([selPort, k]); changed();
				if (justAdded && (nodeOf(selPort) === justAdded || nodeOf(k) === justAdded)) justAdded = null;
			}
			selPort = null;
			redraw();
		}
		function drawHintAndTray() {
			parts.hint.hidden = !editing;
			parts.hint.textContent = selPort ? 'Now tap where the pipe from ' + epLabel(selPort) + ' goes: a pulsing inlet. Tap the outlet again to cancel.'
				: justAdded ? justAdded + ' is in the network (orange box). Connect it: tap an outlet ● then an inlet ○ where the water goes. If it sits in an existing pipe, tap that pipe and choose "Put a meter in this pipe".'
				: 'To add a source or measuring point, tap it under the diagram. To lay a pipe, tap an outlet ● then an inlet ○. Tap a pipe to remove it or put a meter in it. Tap a box to change what it is.';
			var tray = parts.tray;
			tray.textContent = '';
			tray.hidden = !editing;
			if (!editing) return;
			tray.appendChild(el('span', 'muted', 'Add to the network:'));
			allTelepathonNames().filter(function(n) { return roleOf(n) === 'none'; }).forEach(function(n) {
				var b = el('button', 'dvw-chip', '+ ' + n); b.type = 'button';
				b.addEventListener('click', function() { nodeSheet(n); });
				tray.appendChild(b);
			});
			var eb = el('button', 'dvw-chip', '+ Source without a meter (stream, spring…)'); eb.type = 'button';
			eb.addEventListener('click', function() { estSheet(null); });
			tray.appendChild(eb);
			var tb = el('button', 'dvw-chip', '+ Tank without a sensor'); tb.type = 'button';
			tb.addEventListener('click', newTankSheet);
			tray.appendChild(tb);
		}

		// ---------- sheets ----------
		var shade = null, sheet = null;
		function openSheet(build) {
			closeSheet();
			shade = el('div', 'dvw-shade'); sheet = el('div', 'dvw-sheet');
			sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
			shade.addEventListener('click', closeSheet);
			build(sheet);
			document.body.appendChild(shade); document.body.appendChild(sheet);
		}
		function closeSheet() {
			if (shade && shade.parentNode) shade.parentNode.removeChild(shade);
			if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
			shade = sheet = null;
		}
		function acts(sh, list) {
			var a = el('div', 'acts');
			list.forEach(function(b) { var x = el('button', 'btn btn-sm ' + (b.cls || 'btn-default'), b.label); x.type = 'button'; x.addEventListener('click', b.fn); a.appendChild(x); });
			sh.appendChild(a);
		}
		function numberRow(body, label, value, unit, onInput, step) {
			var r = el('div', 'mrow'), inp = el('input');
			r.appendChild(el('span', 'ml', label));
			inp.type = 'number'; inp.value = value || ''; inp.style.width = '7em'; if (step) inp.step = step;
			inp.addEventListener('input', function() { onInput(+inp.value || 0); });
			r.appendChild(inp); r.appendChild(el('span', null, unit));
			body.appendChild(r);
			return inp;
		}

		function nodeSheet(id) {
			if (sinkNamed(id)) return sinkSheet(sinkNamed(id));
			if (estNamed(id)) return estSheet(estNamed(id));
			var t = tel(id) || {role: 'none'}, ms = metersOf(id), lw = levelWordsOf(id);
			var draft = JSON.parse(JSON.stringify(t)), mr = {}, mn = {};
			ms.forEach(function(m) { var k = id + ':' + m; mr[k] = meterRoleOf(k); mn[k] = st.meterNames[k] || ''; });
			if (draft.role === 'none') draft.role = ms.length ? 'measuring' : 'source';
			var sensorless = !!t.sensorless, linkTo = '';
			openSheet(function(sh) {
				sh.appendChild(el('h3', null, id));
				sh.appendChild(el('div', 'muted', sensorless && !live(id) ? 'Tank without a sensor: what flows into it comes from the meters before it'
					: (typeOf(id) ? typeOf(id) + ' · ' : '') + (ms.length ? ms.length + ' flow meter' + (ms.length > 1 ? 's' : '') : 'no flow meter') + (live(id) ? '' : ' · no data from it now')));
				if (sensorless && !live(id)) {
					// the Daffodil came: its telepathon becomes this tank's sensor, keeping the pipes
					var free = liveList().map(function(x) { return x.Name; }).filter(function(n) { return roleOf(n) === 'none'; });
					sh.appendChild(el('label', null, 'Measured by'));
					var ms2 = el('select'), none2 = el('option', null, 'no telepathon yet'); none2.value = ''; ms2.appendChild(none2); ms2.style.width = '100%';
					free.forEach(function(n) { var op = el('option', null, n); op.value = n; ms2.appendChild(op); });
					ms2.addEventListener('change', function() { linkTo = ms2.value; });
					sh.appendChild(ms2);
					sh.appendChild(el('p', 'muted', 'When its sensor is deployed, choose its telepathon here: the tank keeps its pipes and takes the telepathon\'s name, level and meters. A telepathon called ' + id + ' is used by itself.'));
				}
				sh.appendChild(el('label', null, 'In the water network it is'));
				var seg = el('div', 'seg'), body = el('div');
				(sensorless ? [['source', 'Source'], ['none', 'Not in network']] : [['source', 'Source'], ['measuring', 'Measuring point'], ['none', 'Not in network']]).forEach(function(op) {
					var b = el('button', draft.role === op[0] ? 'on' : '', op[1]); b.type = 'button';
					b.addEventListener('click', function() {
						draft.role = op[0];
						Array.prototype.forEach.call(seg.children, function(x) { x.classList.remove('on'); });
						b.classList.add('on');
						ms.forEach(function(m) { var k = id + ':' + m; if (op[0] === 'source' && mr[k] === 'measuring') mr[k] = 'outflow'; if (op[0] === 'measuring' && mr[k] === 'outflow') mr[k] = 'measuring'; });
						fillBody();
					});
					seg.appendChild(b);
				});
				sh.appendChild(seg); sh.appendChild(body);
				function fillBody() {
					body.textContent = '';
					if (draft.role === 'none') { body.appendChild(el('p', 'muted', sensorless ? 'It is removed, with its pipes.' : 'Its pipes are removed. Its readings are kept as before.')); return; }
					if (ms.length) {
						body.appendChild(el('label', null, 'Each flow meter measures'));
						ms.forEach(function(m) {
							var k = id + ':' + m, r = el('div', 'mrow'), s = el('select');
							r.appendChild(el('span', 'ml', m));
							var opts = draft.role === 'source' ? [['outflow', 'Water leaving this source'], ['sink', 'Water leaving the network']] : [['measuring', 'Water passing through'], ['sink', 'Water leaving the network']];
							if (opts.every(function(x) { return x[0] !== mr[k]; })) mr[k] = opts[0][0];
							opts.forEach(function(x) { var op = el('option', null, x[1]); op.value = x[0]; if (mr[k] === x[0]) op.selected = true; s.appendChild(op); });
							s.addEventListener('change', function() { mr[k] = s.value; });
							r.appendChild(s);
							var nm = el('input'); nm.type = 'text'; nm.placeholder = 'its name, e.g. PumpF'; nm.value = mn[k]; nm.style.width = '100%';
							nm.addEventListener('input', function() { mn[k] = cleanName(nm.value); });
							body.appendChild(r); body.appendChild(nm);
						});
					}
					if (draft.role !== 'source') return;
					if (sensorless) draft.tank = true;
					var tk = el('label'), cb = el('input');
					if (sensorless) tk.hidden = true;
					tk.style.fontWeight = 'normal'; cb.type = 'checkbox'; cb.checked = !!draft.tank;
					cb.addEventListener('change', function() { draft.tank = cb.checked; fillBody(); });
					tk.appendChild(cb); tk.appendChild(document.createTextNode(' It holds water (a tank, pool or dam)'));
					body.appendChild(tk);
					if (!draft.tank) return;
					if (!draft.level && lw.length) { draft.level = lw[0].name; draft.levelUnits = lw[0].units; }   // how full, when it has one
					body.appendChild(el('label', null, 'Level from'));
					var ls = el('select'), none = el('option', null, 'no level sensor yet'); none.value = ''; ls.appendChild(none);
					lw.forEach(function(w) { var op = el('option', null, 'Purpose:' + w.name + ' (' + w.units + ')'); op.value = w.name; if (draft.level === w.name) op.selected = true; ls.appendChild(op); });
					if (draft.level && !lw.some(function(w) { return w.name === draft.level; })) { var op2 = el('option', null, 'Purpose:' + draft.level); op2.value = draft.level; op2.selected = true; ls.appendChild(op2); }
					ls.addEventListener('change', function() { draft.level = ls.value || null; var w = lw.filter(function(x) { return x.name === ls.value; })[0]; draft.levelUnits = w ? w.units : null; });
					body.appendChild(ls);
					body.appendChild(el('p', 'muted', 'A level in % is how full it is: 90 % with a height when full of 1800 mm is 1620 mm of water.'));
					var shp = el('label'), cone = el('input');
					shp.style.fontWeight = 'normal'; cone.type = 'checkbox'; cone.checked = draft.shape === 'cone';
					cone.addEventListener('change', function() { draft.shape = cone.checked ? 'cone' : null; });
					shp.appendChild(cone); shp.appendChild(document.createTextNode(' Cone shaped (a dam)'));
					body.appendChild(shp);
					var ra;
					numberRow(body, 'Surface area', draft.area, 'm²', function(v) { draft.area = v; if (draft.rainOnSurface) { draft.rainArea = v; if (ra) ra.value = v; } });
					numberRow(body, 'Capacity', draft.capacity, 'litres when full', function(v) { draft.capacity = v; });
					if (!draft.level) {
						// without a level: what it held at some moment, so what it holds now can be worked out
						body.appendChild(el('label', null, 'What it held, so what it holds can be worked out'));
						var kr = el('div', 'mrow'), kv = el('input'), kt = el('input'), empty = el('button', 'btn btn-default btn-xs', 'It is empty now');
						kv.type = 'number'; kv.style.width = '7em'; kv.value = draft.knownVolume != null ? draft.knownVolume : '';
						kt.type = 'datetime-local';
						function local(ms) { var dd = new Date(ms); return dd.getFullYear() + '-' + two(dd.getMonth() + 1) + '-' + two(dd.getDate()) + 'T' + two(dd.getHours()) + ':' + two(dd.getMinutes()); }
						if (draft.knownAt) kt.value = local(draft.knownAt);
						function setKnown() { var ms = Date.parse(kt.value); if (kv.value !== '' && !isNaN(ms)) { draft.knownVolume = +kv.value; draft.knownAt = ms; } else { delete draft.knownVolume; delete draft.knownAt; } }
						kv.addEventListener('input', setKnown); kt.addEventListener('input', setKnown);
						empty.type = 'button';
						empty.addEventListener('click', function() { kv.value = 0; kt.value = local(Date.now()); setKnown(); });
						kr.appendChild(kv); kr.appendChild(el('span', null, 'L at')); kr.appendChild(kt); kr.appendChild(empty);
						body.appendChild(kr);
						body.appendChild(el('p', 'muted', 'From then on, what the meters show going into it and coming out of it is added up (up to 7 days back). A leak from it cannot be seen until it has a level sensor.'));
					}
					body.appendChild(el('p', 'muted', 'With a level in % and its capacity, what it holds is % × capacity. Its surface area and height are only needed for rain onto it and for its overflow.'));
					numberRow(body, 'Height when full', draft.fullHeight, 'mm', function(v) { draft.fullHeight = v; });
					body.appendChild(el('label', null, 'Rain'));
					var rs = el('select');
					[['surface', 'Falls on its surface (area above)'], ['roof', 'Comes from a roof or catchment'], ['none', 'Gets no rain']].forEach(function(x) { var op = el('option', null, x[1]); op.value = x[0]; rs.appendChild(op); });
					rs.value = !draft.rainArea ? 'none' : draft.rainOnSurface ? 'surface' : 'roof';
					body.appendChild(rs);
					ra = numberRow(body, 'Catchment', draft.rainArea, 'm²', function(v) { draft.rainArea = v; });
					function rainUi() { ra.disabled = rs.value !== 'roof'; ra.parentNode.hidden = rs.value === 'none'; }
					rs.addEventListener('change', function() { draft.rainOnSurface = rs.value === 'surface'; draft.rainArea = rs.value === 'none' ? 0 : rs.value === 'surface' ? draft.area : (draft.rainArea || 40); ra.value = draft.rainArea || ''; rainUi(); });
					rainUi();
					body.appendChild(el('label', null, 'Overflow'));
					numberRow(body, 'Overflows at', draft.overflowHeight, 'mm (empty: never)', function(v) { draft.overflowHeight = v; });
					numberRow(body, 'Lip width', draft.overflowWidth, 'm: how wide the water spills', function(v) { draft.overflowWidth = v; }, '0.1');
					body.appendChild(el('p', 'muted', 'The water spilling over is worked out from how high the level stands above the lip. It leaves the network unless you lay a pipe from the tank\'s overflow outlet.'));
				}
				fillBody();
				acts(sh, [{label: 'Cancel', fn: closeSheet}, {label: 'Apply', cls: 'btn-primary', fn: function() {
					var was = roleOf(id);
					if (draft.role === 'none') {
						delete st.telepathons[id];
						st.conns = st.conns.filter(function(c) { return nodeOf(c[0]) !== id && nodeOf(c[1]) !== id; });
						ms.forEach(function(m) { delete st.meterRole[id + ':' + m]; });
						if (selPort && nodeOf(selPort) === id) selPort = null;
					} else {
						if (draft.role !== 'source') draft.tank = false;
						if (!draft.tank) { ['level', 'levelUnits', 'shape', 'capacity', 'knownVolume', 'knownAt', 'area', 'fullHeight', 'overflowHeight', 'overflowWidth', 'rainArea', 'rainOnSurface'].forEach(function(k) { delete draft[k]; }); }
						st.telepathons[id] = draft;
						for (var k in mr) st.meterRole[k] = mr[k];
						for (var k2 in mn) { if (mn[k2]) st.meterNames[k2] = mn[k2]; else delete st.meterNames[k2]; }
					}
					st.conns = st.conns.filter(function(c) { if (isMeter(c[0]) && st.meterRole[c[0]] === 'sink') return false; if (isMeter(c[1]) && st.meterRole[c[1]] === 'outflow') return false; return true; });
					if (linkTo && draft.role !== 'none') { linkTank(id, linkTo); changed(); closeSheet(); redraw(); nodeSheet(linkTo); return; }
					changed(); closeSheet();
					if (was === 'none' && draft.role !== 'none') justAdded = id;
					redraw();
				}}]);
			});
		}

		// a tank without a sensor gets one: everything named after the tank is named after the telepathon
		function linkTank(from, to) {
			var t = st.telepathons[from];
			delete st.telepathons[from];
			delete t.sensorless;
			st.telepathons[to] = t;
			function key(k) { return k === from ? to : k === from + ' overflow' ? to + ' overflow' : k.indexOf(from + ':') === 0 ? to + k.substring(from.length) : k; }
			st.conns = st.conns.map(function(c) { return [key(c[0]), key(c[1])]; });
			st.sinks.forEach(function(s) { if (s.meter) s.meter = key(s.meter); });
			if (selPort) selPort = key(selPort);
			justAdded = to;
		}
		function newTankSheet() {
			openSheet(function(sh) {
				sh.appendChild(el('h3', null, 'New tank without a sensor'));
				sh.appendChild(el('div', 'muted', 'A tank with no telepathon yet, e.g. TopTank before its Daffodil. Pipes go into and out of it like any tank; what flows in is what the meters before it measure. When its sensor comes, link it in the tank\'s sheet, or give the telepathon the same name.'));
				sh.appendChild(el('label', null, 'Name'));
				var nm = el('input'); nm.type = 'text'; nm.placeholder = 'e.g. TopTank'; nm.style.width = '100%'; sh.appendChild(nm);
				var msg = el('p', 'text-danger'); sh.appendChild(msg);
				acts(sh, [{label: 'Cancel', fn: closeSheet}, {label: 'Add', cls: 'btn-primary', fn: function() {
					var n = cleanName(nm.value);
					if (!n) return nm.focus();
					if (nameTaken(n, null) && !(live(n) && roleOf(n) === 'none')) { msg.textContent = 'Something in this network is already called ' + n + '.'; return; }
					st.telepathons[n] = {role: 'source', tank: true, sensorless: !live(n)};
					justAdded = n; changed(); closeSheet(); redraw();
					nodeSheet(n);   // its area, height, rain, overflow
				}}]);
				setTimeout(function() { nm.focus(); }, 30);
			});
		}

		function outlets() { return Object.keys(PORTS).filter(function(k) { return PORTS[k].out; }); }
		function outletSelect(selected) {
			var s = el('select'); s.style.width = '100%';
			outlets().forEach(function(k) { var op = el('option', null, epLabel(k) + (isMeter(k) ? '' : ' (its outlet)')); op.value = k; if (k === selected) op.selected = true; s.appendChild(op); });
			return s;
		}
		function nameTaken(n, except) {
			return n !== except && (!!st.telepathons[n] || !!sinkNamed(n) || !!estNamed(n) || allTelepathonNames().indexOf(n) >= 0 || n === 'Water Network Settings');
		}

		function sinkSheet(s) {
			var feeds = st.conns.filter(function(c) { return c[1] === s.name; }).map(function(c) { return c[0]; });
			openSheet(function(sh) {
				sh.appendChild(el('h3', null, s.name));
				sh.appendChild(el('div', 'muted', 'Defined sink · learned on ' + (s.meter ? epLabel(s.meter) : '?') + (s.from ? ', ' + s.from + ' to ' + s.to : '')));
				sh.appendChild(el('label', null, 'Name'));
				var nm = el('input'); nm.type = 'text'; nm.value = s.name; nm.style.width = '100%'; sh.appendChild(nm);
				sh.appendChild(el('label', null, 'Water comes from'));
				var list = el('div');
				function drawFeeds() {
					list.textContent = '';
					if (!feeds.length) list.appendChild(el('div', 'muted', 'Nothing yet: it is not connected. Its flow range is kept.'));
					feeds.forEach(function(k, ix) {
						var r = el('div', 'mrow'), t = el('span', null, epLabel(k)), x = el('button', 'btn btn-default btn-xs', 'Remove');
						t.style.flex = '1'; x.type = 'button';
						x.addEventListener('click', function() { feeds.splice(ix, 1); drawFeeds(); });
						r.appendChild(t); r.appendChild(x); list.appendChild(r);
					});
					var add = el('div', 'mrow'), sel = outletSelect(null), b = el('button', 'btn btn-default btn-xs', 'Add');
					sel.style.flex = '1'; sel.style.width = 'auto'; b.type = 'button';
					Array.prototype.slice.call(sel.options).forEach(function(op) { if (feeds.indexOf(op.value) >= 0) op.parentNode.removeChild(op); });
					b.addEventListener('click', function() { if (sel.value) { feeds.push(sel.value); drawFeeds(); } });
					if (sel.options.length) { add.appendChild(sel); add.appendChild(b); list.appendChild(add); }
				}
				drawFeeds(); sh.appendChild(list);
				sh.appendChild(el('p', 'muted', 'A hose point can be fed from more than one place. It is recognised on each meter that feeds it by the same flow range.'));
				sh.appendChild(el('label', null, 'It is running when the flow is between (l/m)'));
				var r = el('div', 'mrow'), a = el('input'), b = el('input');
				a.type = b.type = 'number'; a.step = b.step = '0.5'; a.value = s.min; b.value = s.max; a.style.width = b.style.width = '7em';
				r.appendChild(a); r.appendChild(el('span', null, 'and')); r.appendChild(b); sh.appendChild(r);
				var msg = el('p', 'text-danger'); sh.appendChild(msg);
				acts(sh, [{label: 'Delete sink', cls: 'btn-danger', fn: function() { st.sinks = st.sinks.filter(function(x) { return x !== s; }); st.conns = st.conns.filter(function(c) { return c[1] !== s.name; }); changed(); closeSheet(); redraw(); }},
					{label: 'Cancel', fn: closeSheet},
					{label: 'Apply', cls: 'btn-primary', fn: function() {
						var n2 = cleanName(nm.value);
						if (!n2) return nm.focus();
						if (nameTaken(n2, s.name)) { msg.textContent = 'Something in this network is already called ' + n2 + '.'; return; }
						if (!(+b.value > +a.value)) { msg.textContent = 'The highest flow must be more than the lowest.'; return; }
						st.conns = st.conns.filter(function(c) { return c[1] !== s.name; });
						feeds.forEach(function(k) { st.conns.push([k, n2]); });
						s.name = n2; s.min = +a.value; s.max = +b.value;
						changed(); closeSheet(); redraw();
					}}]);
			});
		}

		function estSheet(u) {
			var isNew = !u;
			u = u || {name: '', what: 'stream / groundwater'};
			openSheet(function(sh) {
				sh.appendChild(el('h3', null, isNew ? 'New source without a meter' : u.name));
				sh.appendChild(el('div', 'muted', 'A stream, spring or runoff: water that comes in where there is no meter. Its flow is worked out from the level of the tank it feeds, so connect it to a tank with a level and a surface area. One per tank.'));
				sh.appendChild(el('label', null, 'Name'));
				var nm = el('input'); nm.type = 'text'; nm.value = u.name; nm.placeholder = 'e.g. Stream'; nm.style.width = '100%'; sh.appendChild(nm);
				sh.appendChild(el('label', null, 'What it is'));
				var wt = el('select'); wt.style.width = '100%';
				['stream / groundwater', 'spring', 'runoff', 'other'].forEach(function(x) { var op = el('option', null, x); op.value = x; if (x === u.what) op.selected = true; wt.appendChild(op); });
				sh.appendChild(wt);
				var msg = el('p', 'text-danger'); sh.appendChild(msg);
				var a = [{label: 'Cancel', fn: closeSheet}, {label: isNew ? 'Add' : 'Apply', cls: 'btn-primary', fn: function() {
					var n2 = cleanName(nm.value);
					if (!n2) return nm.focus();
					if (nameTaken(n2, isNew ? null : u.name)) { msg.textContent = 'Something in this network is already called ' + n2 + '.'; return; }
					if (isNew) { st.unmetered.push({name: n2, what: wt.value}); justAdded = n2; }
					else { st.conns.forEach(function(c) { if (c[0] === u.name) c[0] = n2; }); u.name = n2; u.what = wt.value; }
					changed(); closeSheet(); redraw();
				}}];
				if (!isNew) a.unshift({label: 'Remove', cls: 'btn-danger', fn: function() { st.unmetered = st.unmetered.filter(function(x) { return x !== u; }); st.conns = st.conns.filter(function(c) { return c[0] !== u.name; }); changed(); closeSheet(); redraw(); }});
				acts(sh, a);
			});
		}

		function meterCandidates(c) {
			var list = [];
			allTelepathonNames().forEach(function(name) {
				metersOf(name).forEach(function(m) {
					var k = name + ':' + m;
					if (k === c[0] || k === c[1] || nodeOf(c[0]) === name || nodeOf(c[1]) === name) return;
					if (roleOf(name) === 'source') return;
					if (roleOf(name) === 'measuring' && meterRoleOf(k) !== 'measuring') return;
					if (st.conns.some(function(x) { return x[1] === k; })) return;
					list.push(k);
				});
			});
			return list;
		}
		function insertMeter(ix, k) {
			var c = st.conns[ix], name = nodeOf(k);
			if (roleOf(name) === 'none') { st.telepathons[name] = {role: 'measuring'}; metersOf(name).forEach(function(m) { st.meterRole[name + ':' + m] = 'measuring'; }); }
			st.meterRole[k] = 'measuring';
			st.conns.splice(ix, 1, [c[0], k], [k, c[1]]);
			if (justAdded === name) justAdded = null;
			changed();
		}
		function pipeSheet(ix) {
			var c = st.conns[ix];
			openSheet(function(sh) {
				sh.appendChild(el('h3', null, 'Pipe'));
				sh.appendChild(el('div', null, epLabel(c[0]) + '  →  ' + epLabel(c[1])));
				var cands = meterCandidates(c), sel = null;
				if (cands.length) {
					sh.appendChild(el('label', null, 'Put a meter in this pipe'));
					sel = el('select'); sel.style.width = '100%';
					cands.forEach(function(k) { var op = el('option', null, epLabel(k) + (roleOf(nodeOf(k)) === 'none' ? ' (adds ' + nodeOf(k) + ' as a measuring point)' : '')); op.value = k; sel.appendChild(op); });
					sh.appendChild(sel);
					sh.appendChild(el('p', 'muted', 'The pipe becomes ' + epLabel(c[0]) + ' → the meter → ' + epLabel(c[1]) + '.'));
				}
				var a = [{label: 'Remove pipe', cls: 'btn-danger', fn: function() { st.conns.splice(ix, 1); changed(); closeSheet(); redraw(); }}, {label: 'Cancel', fn: closeSheet}];
				if (sel) a.push({label: 'Put it in', cls: 'btn-primary', fn: function() { insertMeter(ix, sel.value); closeSheet(); redraw(); }});
				acts(sh, a);
			});
		}

		// ---------- checks ----------
		function drawChecks() {
			var list = [];
			Object.keys(PORTS).forEach(function(k) {
				var j = junction(k);
				if (j && j.apart) list.push({id: 'j' + k, cls: 'warn', title: epLabel(k) + ' → ' + children(k).map(epLabel).join(' + '), val: 'not compared',
					detail: j.missing ? 'One of these meters has not reported yet.' : 'These meters were read ' + Math.round(j.spread) + ' s apart, so their flows are not compared (more than ' + STALE_APART_SECONDS + ' s).'});
				else if (j) list.push({id: 'j' + k, cls: j.bad ? 'bad' : 'ok', title: epLabel(k) + ' → ' + children(k).map(epLabel).join(' + '), val: j.bad ? 'lost ' + j.diff.toFixed(1) + ' l/m' : 'balanced',
					detail: epLabel(k) + ' ' + f(outValue(k)) + ' l/m; the meters after it add up to ' + f(j.sum) + ' l/m. ' + (j.bad ? j.diff.toFixed(1) + ' l/m is leaving the pipe between them.' : 'Within ±' + st.settings.tolerance + ' l/m.')});
				var sk = sinksOn(k);
				if (sk.length) {
					var v = outValue(k), at = attribute(v, sk), names = Object.keys(at.by);
					list.push({id: 's' + k, cls: at.unexplained > 0.05 ? 'bad' : 'ok', title: epLabel(k) + ' explained', val: v < st.settings.minFlow ? 'no flow' : at.unexplained > 0.05 ? '? ' + at.unexplained.toFixed(1) + ' l/m' : names.join(' + '),
						detail: at.unexplained > 0.05 ? at.unexplained.toFixed(1) + ' l/m matches none of its defined sinks (' + sk.map(function(s) { return s.name + ' ' + s.min + '–' + s.max; }).join(', ') + '). A new use to name, or a leak after this meter.' : 'Every litre on this meter belongs to a defined sink.'});
				}
			});
			NODES.filter(function(n) { return n.kind === 'tank'; }).forEach(function(n) {
				var t = n.t;
				if (!t.level && t.knownVolume != null) {
					var e = tankEstimate(n.id), L0 = function(v) { return Math.round(v).toLocaleString() + ' L'; };
					if (!e || e.waiting) { list.push({id: 't' + n.id, cls: 'warn', title: n.id + ' (estimated)', val: 'reading history…', detail: 'Reading the meters since ' + stamp(t.knownAt) + '.'}); return; }
					if (e.tooOld) { list.push({id: 't' + n.id, cls: 'warn', title: n.id + ' (estimated)', val: 'start too old', detail: 'What it held is known from ' + stamp(t.knownAt) + ', more than 7 days ago, further back than the history goes. Give a newer one in its sheet (Edit network), e.g. It is empty now.'}); return; }
					list.push({id: 't' + n.id, cls: 'ok', title: n.id + ' (estimated)', val: '≈ ' + L0(e.volume) + (t.capacity ? ' of ' + L0(t.capacity) : ''),
						detail: 'It held ' + L0(t.knownVolume) + ' at ' + stamp(t.knownAt) + '. Since then ' + L0(e.inL) + ' went into it (what PumpF and the meters before it sent that the meters after it did not take) and ' + L0(e.outL) + ' came out of it (what the meters after it took beyond what came from before). A leak from it cannot be seen until it has a level sensor.'});
					if (e.shortL > st.settings.tolerance * 5) list.push({id: 'ts' + n.id, cls: 'bad', title: 'Water from nowhere after ' + n.id, val: L0(e.shortL),
						detail: L0(e.shortL) + ' went through the meters after ' + n.id + ' while it should have been empty. Either it held more at ' + stamp(t.knownAt) + ' than given, or water reached them another way (a pipe without a meter).'});
					if (e.overL > st.settings.tolerance * 5) list.push({id: 'to' + n.id, cls: 'warn', title: n.id + ' over its capacity', val: L0(e.overL),
						detail: 'Going by the meters, ' + L0(e.overL) + ' more went into ' + n.id + ' than it holds: it overflowed, water leaked on the way up, or it held less at the start than given.'});
					return;
				}
				if (!t.level) {
					var fl = filledLastHour(n.id);
					list.push({id: 't' + n.id, cls: 'warn', title: 'Into ' + n.id + ' (no sensor)', val: fl ? Math.round(fl).toLocaleString() + ' L last hour' : 'no sensor yet',
						detail: (fl ? Math.round(fl).toLocaleString() + ' L went into ' + n.id + ' through the meters before it in the last hour' + (t.capacity ? ' (it holds ' + Math.round(t.capacity).toLocaleString() + ' L)' : '') + '. ' : '')
							+ 'Without a level the network cannot tell how full it is, nor whether water came in or left it any other way. When its sensor is deployed, link its telepathon in its sheet.'});
					return;
				}
				if (!t.area && !t.capacity) { list.push({id: 't' + n.id, cls: 'warn', title: n.id + ' balance', val: 'needs its capacity', detail: 'Set ' + n.id + '\'s capacity (or its surface area; tap it in Edit network). Then what it gained + water pumped out − water pumped in is the water that came in without a meter.'}); return; }
				var b = tankBalance(n.id);
				if (!b || b.waiting) { list.push({id: 't' + n.id, cls: 'warn', title: n.id + ' balance', val: 'reading history…', detail: 'Waiting for the last hour of ' + n.id + '\'s level.'}); return; }
				if (b.needsFull) { list.push({id: 't' + n.id, cls: 'warn', title: n.id + ' balance', val: 'needs height when full', detail: n.id + '\'s level is in %, so its height when full is needed to turn it into millimetres.'}); return; }
				var clear = Math.abs(b.unmetered) > b.resolutionL;
				var rainMm = t.rainArea ? b.unmetered / t.rainArea : null;
				list.push({id: 't' + n.id, cls: !clear ? 'ok' : b.unmetered > 0 ? 'warn' : 'bad', title: 'Water into ' + n.id + ' without a meter',
					val: !clear ? '≈ 0' : (b.unmetered > 0 ? '+' : '') + Math.round(b.unmetered) + ' L' + (rainMm !== null && b.unmetered > 0 ? ' (≈ ' + rainMm.toFixed(0) + ' mm)' : ''),
					detail: 'Over the last ' + Math.round(b.minutes) + ' minutes ' + n.id + (b.byCapacity ? ' gained ' + Math.round(b.riseL) + ' L' : ' rose ' + b.rise.toFixed(0) + ' mm = ' + Math.round(b.riseL) + ' L') + '. Its meters took ' + Math.round(b.outL) + ' L out and ' + Math.round(b.inL) + ' L came in through pipes with meters, so ' + Math.round(b.unmetered) + ' L came in some other way'
						+ (b.unmetered < 0 ? ' (less than nothing: water is leaving it without a meter, a leak or an overflow).' : ': rain' + (st.conns.some(function(c) { return estNamed(c[0]) && c[1] === n.id; }) ? ' or the source without a meter that feeds it.' : ', or a stream: add a source without a meter if one feeds it.'))
						+ (b.byCapacity ? ' The level reads in whole % = ' + Math.round(b.resolutionL) + ' L, so less than that is not counted.' : ' The level reads in steps of ' + b.resolutionMm.toFixed(0) + ' mm = ' + Math.round(b.resolutionL) + ' L on ' + t.area + ' m², so less than that is not counted.') + (b.missing ? ' Some meter history is still coming.' : '')});
				var ov = overflowNow(n.id);
				if (ov > 0.5) list.push({id: 'ov' + n.id, cls: 'bad', title: n.id + ' overflowing', val: '≈ ' + ov.toFixed(0) + ' l/m', detail: 'The level is ' + (depthMm(n.id) - t.overflowHeight).toFixed(0) + ' mm above the overflow (' + t.overflowHeight + ' mm). Over a ' + (t.overflowWidth || 0.3) + ' m lip that is about ' + ov.toFixed(0) + ' l/m (weir formula). Rough.'});
			});
			var c = parts.checks;
			c.textContent = '';
			if (!list.length) list.push({id: 'none', cls: '', title: 'No checks yet', val: '', detail: 'Lay pipes between meters, or name defined sinks on a meter\'s chart, and the checks appear here.'});
			list.forEach(function(x) {
				var d = el('div', 'dvw-check ' + x.cls + (openChecks[x.id] ? ' open' : '')), b = el('button');
				b.type = 'button'; b.setAttribute('aria-expanded', String(!!openChecks[x.id]));
				b.appendChild(el('span', 'dot')); b.appendChild(el('span', 'ct', x.title)); b.appendChild(el('span', 'cv', x.val));
				b.addEventListener('click', function() { openChecks[x.id] = !openChecks[x.id]; d.classList.toggle('open'); b.setAttribute('aria-expanded', String(!!openChecks[x.id])); });
				d.appendChild(b); d.appendChild(el('div', 'cd', x.detail)); c.appendChild(d);
			});
		}

		// ---------- chart: a meter's last hour, coloured by the defined sink each reading belongs to ----------
		var CH = {l: 46, r: 12, t: 12, b: 30, W: 1000, H: 260};
		function upstreamMeter(k) { var c = st.conns.filter(function(x) { return x[1] === k && isMeter(x[0]); })[0]; return c ? c[0] : null; }
		function chartMeters() {
			var list = [];
			allTelepathonNames().forEach(function(n) { if (roleOf(n) !== 'none') metersOf(n).forEach(function(m) { list.push(n + ':' + m); }); });
			return list;
		}
		function drawChart() {
			var svg = parts.chart, ms = chartMeters();
			svg.textContent = '';
			parts.chartMeter.textContent = '';
			ms.forEach(function(k) { var op = el('option', null, epLabel(k)); op.value = k; parts.chartMeter.appendChild(op); });
			if (ms.indexOf(chartKey) < 0) chartKey = ms.filter(function(k) { return st.sinks.some(function(s) { return s.meter === k; }); })[0] || ms[0] || null;
			parts.legend.textContent = '';
			if (!chartKey) { S('text', {x: CH.l, y: 40}, svg, 'Put a telepathon with a flow meter in the network to chart it.'); return; }
			parts.chartMeter.value = chartKey;
			var data = wantHistory(chartKey, chartRange), up = upstreamMeter(chartKey), upData = up ? wantHistory(up, chartRange) : null;
			var t1 = chartView ? chartView.t1 : Date.now(), t0 = chartView ? chartView.t0 : t1 - chartRange;
			parts.zoomBar.hidden = !chartView;
			var ymax = 10;
			(data || []).concat(upData || []).forEach(function(r) { if (r.t >= t0 && r.t <= t1 && r.v > ymax) ymax = r.v; });
			ymax = Math.ceil(ymax * 1.1 / 10) * 10;
			function x(t) { return CH.l + (t - t0) / (t1 - t0) * (CH.W - CH.l - CH.r); }
			function y(v) { return CH.t + (1 - v / ymax) * (CH.H - CH.t - CH.b); }
			parts.x = x; parts.t0 = t0; parts.t1 = t1;
			var sk = sinksOn(chartKey);
			(data || []).forEach(function(r, i) {
				var next = Math.min(t1, i + 1 < data.length ? data[i + 1].t : t1);
				if (next <= t0 || r.t >= t1) return;
				var at = attribute(r.v, sk), keys = Object.keys(at.by), col = null;
				if (at.unexplained > 0.05) col = '#c0392b'; else if (keys.length) { var s = sinkNamed(keys[0]); col = s ? s.color : null; }
				var ra = Math.max(t0, r.t);
				if (col) S('rect', {x: x(ra), y: CH.t, width: Math.max(0.5, x(next) - x(ra)), height: CH.H - CH.t - CH.b, fill: col, opacity: 0.13}, svg);
			});
			for (var v = 0; v <= ymax; v += ymax / 5) { S('line', {x1: CH.l, x2: CH.W - CH.r, y1: y(v), y2: y(v), 'class': 'ax'}, svg); S('text', {x: CH.l - 6, y: y(v) + 4, 'text-anchor': 'end'}, svg, Math.round(v)); }
			var span = t1 - t0, days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
			for (var m = 0; m <= 6; m++) {
				var tt = t0 + span * m / 6, dd = new Date(tt);
				S('text', {x: x(tt), y: CH.H - 10, 'text-anchor': 'middle'}, svg, span > 20 * 3600000 ? days[dd.getDay()] + ' ' + hhmm(tt) : span < 900000 ? hhmm(tt) + ':' + two(dd.getSeconds()) : hhmm(tt));
			}
			S('text', {x: CH.l, y: CH.t - 1}, svg, 'l/m');
			function line(list, cls) {
				var d = '';
				(list || []).forEach(function(r, i) {
					var nt = Math.min(t1, i + 1 < list.length ? list[i + 1].t : t1);
					if (nt <= t0 || r.t >= t1) return;
					d += (d ? 'L' : 'M') + x(Math.max(t0, r.t)).toFixed(1) + ' ' + y(r.v).toFixed(1); d += 'L' + x(nt).toFixed(1) + ' ' + y(r.v).toFixed(1);
				});
				if (d) S('path', {d: d, 'class': cls}, svg);
			}
			if (upData) line(upData, 'ln2');
			if (!data) S('text', {x: CH.l + 10, y: 40}, svg, 'Reading the history…');
			else if (!data.length) S('text', {x: CH.l + 10, y: 40}, svg, 'No readings in this period.');
			line(data, 'ln');
			// close up: a dot on each reading, so it is clear where the samples are
			var shown = (data || []).filter(function(r) { return r.t >= t0 && r.t <= t1; });
			if (shown.length && shown.length <= 150) shown.forEach(function(r) { S('circle', {cx: x(r.t), cy: y(r.v), r: 3, fill: '#2a7fd4'}, svg); });
			// how much water went through in what is shown: each reading's l/m for as long as it held
			var total = data ? litres(data, t0, t1) : null, upTotal = upData ? litres(upData, t0, t1) : null;
			function litresText(v) { return Math.round(v).toLocaleString() + ' L'; }
			S('text', {x: CH.W - CH.r, y: CH.t + 10, 'text-anchor': 'end'}, svg, (chartView ? new Date(t0).toLocaleDateString() + ' ' + hhmm(t0) + ' – ' + hhmm(t1) + ' · ' + shown.length + ' readings · ' : '') + (total !== null ? litresText(total) : ''));
			if (drag) S('rect', {x: Math.min(drag.a, drag.b), y: CH.t, width: Math.abs(drag.b - drag.a), height: CH.H - CH.t - CH.b, 'class': 'selr'}, svg);
			function li(col, txt, dashed) { var s = el('span'), sw = el('span', 'sw'); sw.style.background = dashed ? 'none' : col; if (dashed) { sw.style.borderTop = '2px dashed ' + col; sw.style.height = '0'; } s.appendChild(sw); s.appendChild(document.createTextNode(txt)); parts.legend.appendChild(s); }
			li('#2a7fd4', epLabel(chartKey) + (total !== null ? ': ' + litresText(total) + ' from ' + hhmm(t0) + ' to ' + hhmm(t1) : ''));
			if (up) li('#5f6b64', epLabel(up) + ' (before it)' + (upTotal !== null ? ': ' + litresText(upTotal) : ''), true);
			sk.forEach(function(s) { li(s.color, s.name + ' (' + s.min + '–' + s.max + ')'); });
			st.sinks.filter(function(s) { return s.meter === chartKey && sk.indexOf(s) < 0; }).forEach(function(s) { li(s.color, s.name + ' (' + s.min + '–' + s.max + ', not connected here)', true); });
			li('#c0392b', 'unexplained');
		}
		function zoomBy(factor) {
			if (!chartView) return;
			var now = Date.now(), mid = (chartView.t0 + chartView.t1) / 2, half = (chartView.t1 - chartView.t0) * factor / 2;
			if (half * 2 >= chartRange) { chartView = null; drawChart(); return; }
			chartView = clampView(mid - half, mid + half, now);
			drawChart();
		}
		function pan(fraction) {
			if (!chartView) return;
			var w = chartView.t1 - chartView.t0;
			chartView = clampView(chartView.t0 + w * fraction, chartView.t1 + w * fraction, Date.now());
			drawChart();
		}
		function clampView(a, b, now) {
			var lo = now - chartRange, w = b - a;
			if (a < lo) { a = lo; b = lo + w; }
			if (b > now) { b = now; a = now - w; }
			return {t0: a, t1: b};
		}
		function chartX(ev) { var r = parts.chart.getBoundingClientRect(); return Math.max(CH.l, Math.min(CH.W - CH.r, (ev.clientX - r.left) * CH.W / r.width)); }
		function xToT(px) { return parts.t0 + (px - CH.l) / (CH.W - CH.l - CH.r) * (parts.t1 - parts.t0); }
		function chartEvents() {
			parts.chart.addEventListener('pointerdown', function(e) { drag = {a: chartX(e), b: chartX(e)}; try { parts.chart.setPointerCapture(e.pointerId); } catch (x) {} });
			parts.chart.addEventListener('pointermove', function(e) { if (!drag) return; drag.b = chartX(e); drawChart(); });
			parts.chart.addEventListener('pointerup', function() {
				if (!drag) return;
				var a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b);
				drag = null;
				if (b - a < 8) return drawChart();
				var ta = xToT(a), tb = xToT(b);
				if (tb - ta < 20000) { var mid = (ta + tb) / 2; ta = mid - 10000; tb = mid + 10000; }   // 20 s at the closest
				chartView = {t0: ta, t1: tb};
				drawChart();
			});
		}
		function newSinkSheet(ta, tb) {
			var vals = [], hk = chartKey + '|' + chartRange;
			(history[hk] && history[hk].data || []).forEach(function(r, i, list) {
				var next = i + 1 < list.length ? list[i + 1].t : Date.now();
				if (next > ta && r.t < tb && r.v >= st.settings.minFlow) vals.push(r.v);
			});
			if (!vals.length) { drawChart(); return; }
			vals.sort(function(p, q) { return p - q; });
			var mn = vals[0], mx = vals[vals.length - 1], med = vals[Math.floor(vals.length / 2)], key = chartKey;
			openSheet(function(sh) {
				sh.appendChild(el('h3', null, 'New defined sink'));
				sh.appendChild(el('div', 'muted', epLabel(key) + ', ' + new Date(ta).toLocaleDateString() + ' ' + hhmm(ta) + ' to ' + hhmm(tb)));
				var stt = el('div', 'stat');
				[['lowest', mn], ['median', med], ['highest', mx]].forEach(function(p) { var d = el('div', null, p[0]); d.appendChild(el('b', null, p[1].toFixed(1))); stt.appendChild(d); });
				sh.appendChild(stt);
				sh.appendChild(el('label', null, 'Name'));
				var nm = el('input'); nm.type = 'text'; nm.placeholder = 'e.g. Greenhouse Hose'; nm.style.width = '100%'; sh.appendChild(nm);
				sh.appendChild(el('label', null, 'Water comes from'));
				var from = outletSelect(key); sh.appendChild(from);
				sh.appendChild(el('p', 'muted', 'The sink is a pipe from here. It is recognised by the flow on this meter.'));
				sh.appendChild(el('label', null, 'It is running when that flow is between (l/m)'));
				var r = el('div', 'mrow'), lo = el('input'), hi = el('input');
				lo.type = hi.type = 'number'; lo.step = hi.step = '0.5'; lo.value = Math.floor(mn * 0.9 * 2) / 2; hi.value = Math.ceil(mx * 1.08 * 2) / 2; lo.style.width = hi.style.width = '7em';
				r.appendChild(lo); r.appendChild(el('span', null, 'and')); r.appendChild(hi); sh.appendChild(r);
				var msg = el('p', 'text-danger'); sh.appendChild(msg);
				acts(sh, [{label: 'Cancel', fn: function() { closeSheet(); drawChart(); }}, {label: 'Add', cls: 'btn-primary', fn: function() {
					var name = cleanName(nm.value);
					if (!name) return nm.focus();
					if (nameTaken(name, sinkNamed(name) ? name : null) && !sinkNamed(name)) { msg.textContent = 'Something in this network is already called ' + name + '.'; return; }
					st.sinks = st.sinks.filter(function(s) { return s.name !== name; });
					st.conns = st.conns.filter(function(c) { return c[1] !== name; });
					var used = st.sinks.map(function(s) { return s.color; }), col = SINK_COLORS.filter(function(c) { return used.indexOf(c) < 0; })[0] || '#7f8c8d';
					st.sinks.push({name: name, min: +lo.value, max: +hi.value, from: stamp(ta), to: stamp(tb), color: col, meter: key});
					st.conns.push([from.value, name]);
					if (!editing) { editing = true; if (!snapshot) snapshot = JSON.stringify(st); }
					changed(); closeSheet(); render();
				}}]);
				setTimeout(function() { nm.focus(); }, 30);
			});
		}

		// ---------- saving ----------
		function saveBar() {
			var bar = el('div', 'dvw-savebar'), msg = el('span', 'msg', message || (dirty ? 'Not saved yet' : 'No changes yet'));
			var code = el('input', 'form-control input-sm'); code.type = 'text'; code.placeholder = 'code'; code.maxLength = 6; code.inputMode = 'numeric'; code.setAttribute('aria-label', '6-digit code');
			var discard = el('button', 'btn btn-default btn-sm', savedChainName ? 'Discard' : 'Cancel'), save = el('button', 'btn btn-primary btn-sm', 'Save'), del = null;
			discard.type = save.type = 'button';
			bar.appendChild(msg);
			if (o.needsCode !== false) bar.appendChild(code);
			bar.appendChild(discard);
			if (savedChainName) { del = el('button', 'btn btn-danger btn-sm', 'Delete network'); del.type = 'button'; bar.appendChild(del); }
			bar.appendChild(save);
			function busy(on) { [discard, save, del].forEach(function(b) { if (b) b.disabled = on; }); }
			discard.addEventListener('click', function() {
				if (!savedChainName) { if (o.removed) o.removed(); return; }
				if (snapshot) st = JSON.parse(snapshot);
				dirty = false; editing = false; selPort = null; justAdded = null; message = '';
				render();
			});
			save.addEventListener('click', function() {
				var c = code.value.trim();
				if (o.needsCode !== false && !/^\d{6}$/.test(c)) { msg.textContent = 'Enter the 6-digit code from your authenticator app first.'; code.focus(); return; }
				var chain = toChain(st, o.teleonomeName, prefix, metersOf);
				busy(true); msg.textContent = 'Saving…';
				o.save(chain, savedChainName, c).then(function(r) {
					savedChainName = chain.Name; snapshot = JSON.stringify(st); dirty = false; editing = false; selPort = null; justAdded = null;
					message = r && r.waiting ? 'Sent. The Teleonome takes it at its next pulse.' : 'Saved.';
					render();
					setTimeout(function() { message = ''; }, 8000);
				}).catch(function(err) { msg.textContent = err && err.message ? err.message : String(err); }).then(function() { busy(false); });
			});
			if (del) del.addEventListener('click', function() {
				var c = code.value.trim();
				if (!window.confirm('Delete the water network “' + st.name + '”? Its readings are kept; only the network goes.')) return;
				if (o.needsCode !== false && !/^\d{6}$/.test(c)) { msg.textContent = 'Enter the 6-digit code from your authenticator app first.'; code.focus(); return; }
				busy(true); msg.textContent = 'Deleting…';
				o.remove(savedChainName, c).then(function() { if (o.removed) o.removed(); })
					.catch(function(err) { msg.textContent = err && err.message ? err.message : String(err); }).then(function() { busy(false); });
			});
			return bar;
		}

		function redraw() {
			if (!root) return render();
			var hasBar = !!root.querySelector('.dvw-savebar');
			if (hasBar !== editing) return render();
			if (hasBar) { var m = root.querySelector('.dvw-savebar .msg'); if (m && !message) m.textContent = dirty ? 'Not saved yet' : 'No changes yet'; }
			drawLive();
		}

		var lastNarrow = null;
		function onResize() { if (!root || !root.parentNode) return; var n = (o.view.clientWidth || 1000) < 620; if (n !== lastNarrow) { lastNarrow = n; drawNet(); } }
		window.addEventListener('resize', onResize);
		document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeSheet(); if (selPort) { selPort = null; if (root && root.parentNode) drawNet(); } } });

		return {
			render: render,
			// new telepathon values: redraw the diagram, the checks and the chart (not a sheet being filled in)
			refresh: function() { if (root && root.parentNode && !sheet) drawLive(); },
			setChain: function(chain) {
				if (editing || dirty || !chain) return;
				st = fromChain(chain, prefix); savedChainName = chain.Name; snapshot = JSON.stringify(st);
			},
			name: function() { return st.name; },
			isEditing: function() { return editing; },
			// what a tank without a sensor holds, worked out from the meters: {volume, inL, outL, overL, shortL} or null
			tankEstimate: function(name) { return tankEstimate(name); },
			chain: function() { return toChain(st, o.teleonomeName, prefix, metersOf); }
		};
	}

	return {create: create, fromChain: fromChain, toChain: toChain};
})();
