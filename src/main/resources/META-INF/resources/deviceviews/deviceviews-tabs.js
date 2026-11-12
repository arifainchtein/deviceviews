// deviceviews tabs (2026-11-08): custom data views, the same on the Teleonome (Annabelle's page) and on
// devices.digitalstables.com (the customer's page, e.g. /chilhuacle). A row of pills - the host's own views
// first (the map), then one pill per tab the farm made (e.g. "Greenhouse"), then "+ New tab". A tab is a name
// and the values it shows, picked from ALL of the farm's telepathons, plus the weather forecast. After the host's
// own views comes "Weather", always (2026-11-12): the forecast Annabelle downloaded, drawn by deviceviews-weather.js
// (load it before this file; without it there is no Weather pill and forecast items show "—"):
//
//   {type: "word", telepathon: "ChinampaData", dene: "Purpose", word: "Outdoor Temperature", label: "", charts: true}
//       charts: the 1h / 24h / 7d chart buttons under the value, as in a device's details (2026-11-08)
//   word and forecast items may have alerts: [{op: "<"|"<="|">"|">=", value: 5, color: "red"|"yellow"|"green"|"blue"}]:
//       the first that holds colours the tile's heading (e.g. tomorrow 06:00 < 5 -> blue, greenhouse > 35 -> red)
//   {type: "level", telepathon: "ChinampaData", tank: "Fish Tank", label: ""}      the level colour, as on the card
//   {type: "forecast", what: "temp"|"min"|"max", day: 0..4, hour: 0..23, label: ""}
//       from the "Weather Forecast" dene of Annabelle's telepathon (OpenWeather, the forecast the field devices
//       were sent), not downloaded here - until 2026-11-12 it came from Open-Meteo, another provider
//
// Values are found by telepathon name, dene name and dene word name, so a tab means the same on both hosts.
// Like the rest of deviceviews this only reads telepathons; the host keeps the tabs (save / remove below).
// Plain DOM, text set with textContent only; Bootstrap 3 classes (both hosts load it). Needs deviceviews-base.js
// and deviceviews-card.js (computeTelepathonAgeStatus) loaded first.
//
//   var tabs = DeviceViewsTabs.create({
//     pills: element, view: element, editor: element,   // where the pills, a tab and the tab editor go
//     telepathons: function() { return [...]; },          // the farm's telepathons now
//     builtIn: [{id: "map", name: "Map", available: fn, show: fn, hide: fn}],   // the host's own views
//     tabs: [{id, name, items}],                          // the farm's tabs
//     canEdit: true,                                      // show "+ New tab" and "Edit"
//     needsCode: true,                                    // saving asks for the authenticator code (or a
//                                                         // function: false while the host knows it was just given)
//     save: function(tab, code) { return Promise({tabs, id}) },   // tab = {id (null: new), name, items}
//     remove: function(id, code) { return Promise({tabs}) },
//     ageSeconds: function(telepathonName) { return seconds or null },        // optional
//     canChart: function(telepathonName) { return true/false },               // optional: history to chart?
//     storageKey: "..."                                   // remembers the chosen pill in this browser
//   });
//   tabs.refresh();   // new telepathons: redraw the values
//   tabs.setTabs(t);  // the tabs changed elsewhere

var DeviceViewsTabs = (function() {

	var DAYS = typeof DeviceViewsWeather !== 'undefined' ? DeviceViewsWeather.DAYS : ["today", "tomorrow", "the day after", "in 3 days", "in 4 days"];
	var WEATHER_PILL = 'weather';
	var LEVEL_HEX = {Red: '#e74c3c', Green: '#27ae60', Blue: '#2060ff', Gray: '#95a5a6'};
	// Soft bands for a tile's heading when one of its alerts holds; dark text, so they read in a dark theme too.
	var ALERT_COLORS = {
		red: {bg: '#fadbd8', fg: '#7b241c', name: 'Red'},
		yellow: {bg: '#fcf3cf', fg: '#7d6608', name: 'Yellow'},
		green: {bg: '#d5f5e3', fg: '#1d6b40', name: 'Green'},
		blue: {bg: '#d6eaf8', fg: '#1b4f72', name: 'Blue'}
	};
	var ALERT_OPS = {'<': 'below', '<=': 'at or below', '>': 'above', '>=': 'at or above'};
	var MAX_ALERTS = 4;

	// The first of the item's alerts that holds for this number, or null.
	function alertFor(item, number) {
		if (typeof number !== 'number' || isNaN(number)) return null;
		var alerts = item.alerts || [];
		for (var i = 0; i < alerts.length; i++) {
			var a = alerts[i], v = a.value;
			if (!ALERT_COLORS[a.color] || typeof v !== 'number') continue;
			if ((a.op === '<' && number < v) || (a.op === '<=' && number <= v) ||
				(a.op === '>' && number > v) || (a.op === '>=' && number >= v)) return a;
		}
		return null;
	}

	function toNumber(value) {
		if (typeof value === 'number') return value;
		if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return parseFloat(value);
		return NaN;
	}

	// ---- styles, once: the Teleonome does not load deviceviews.css, so they come with the script ----
	function addStyles() {
		if (document.getElementById('dvt-styles')) return;
		var css =
			'.dvt-pills{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:0;list-style:none}' +
			'.dvt-pills .dvt-pill{font:inherit;font-size:14px;font-weight:600;border:1px solid var(--dvt-line,#d5dbd7);border-radius:999px;' +
			'  background:var(--dvt-card,#fff);color:var(--dvt-text,#1d2420);padding:6px 14px;cursor:pointer;line-height:1.3}' +
			'.dvt-pills .dvt-pill.dvt-on{background:var(--dvt-accent,#2f7d4f);border-color:var(--dvt-accent,#2f7d4f);color:var(--dvt-accent-text,#fff)}' +
			'.dvt-pills .dvt-pill.dvt-new{border-style:dashed;color:var(--dvt-muted,#5f6b64)}' +
			'.dvt-pills .dvt-pill.dvt-new.dvt-on{border-style:solid;color:var(--dvt-accent-text,#fff)}' +
			'.dvt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 12px}' +
			'.dvt-head h2{margin:0;font-size:18px;font-weight:700}' +
			'.dvt-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:10px}' +
			'.dvt-tile{background:var(--dvt-tile,#f0f4f1);border-radius:10px;padding:10px 12px;min-width:0}' +
			'.dvt-tile .dvt-name{font-size:13px;font-weight:600;color:var(--dvt-text,#1d2420);overflow-wrap:anywhere}' +
			'.dvt-tile .dvt-from{font-size:12px;color:var(--dvt-muted,#5f6b64);overflow-wrap:anywhere}' +
			'.dvt-tile .dvt-value{font-size:26px;font-weight:700;line-height:1.25;margin-top:4px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}' +
			'.dvt-tile .dvt-units{font-size:14px;font-weight:600;color:var(--dvt-muted,#5f6b64);margin-left:3px}' +
			'.dvt-tile .dvt-age{font-size:12px;color:var(--dvt-muted,#5f6b64);margin-top:2px}' +
			'.dvt-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}' +
			'.dvt-square{display:inline-block;width:26px;height:26px;border-radius:4px;border:1px solid #999;vertical-align:middle;margin-right:8px}' +
			'.dvt-empty{color:var(--dvt-muted,#5f6b64);margin:4px 0}' +
			'.dvt-editor .dvt-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 0;border-top:1px solid var(--dvt-line,#e3e7e4)}' +
			'.dvt-editor .dvt-row:first-child{border-top:0}' +
			'.dvt-editor .dvt-what{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}' +
			'.dvt-editor .dvt-what small{display:block;color:var(--dvt-muted,#5f6b64)}' +
			'.dvt-editor .dvt-label{flex:0 1 180px;min-width:120px}' +
			'.dvt-editor .dvt-add{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 4px}' +
			'.dvt-editor .dvt-add select{flex:1 1 200px;min-width:0;max-width:100%}' +
			'.dvt-editor .dvt-section{margin:14px 0 6px;font-weight:700}' +
			'.dvt-editor .dvt-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}' +
			'.dvt-editor .dvt-code{width:10ch;text-align:center;letter-spacing:.2em}' +
			'.dvt-editor .dvt-message{color:#c0392b;min-height:1.2em;margin:8px 0 0}' +
			'.dvt-small-btn{padding:2px 9px}' +
			'.dvt-charts{margin-top:6px;display:flex;gap:4px;flex-wrap:wrap}' +
			'.dvt-tile .dvt-band{margin:-10px -12px 6px;padding:8px 12px 6px;border-radius:10px 10px 0 0}' +
			'.dvt-tile .dvt-band.dvt-alert .dvt-name,.dvt-tile .dvt-band.dvt-alert .dvt-from{color:inherit}' +
			'.dvt-tile .dvt-why{font-size:11px;font-weight:600;margin-top:2px}' +
			'.dvt-editor .dvt-alerts{flex:1 1 100%;display:flex;flex-direction:column;gap:4px;padding-left:12px}' +
			'.dvt-editor .dvt-alert-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:13px}' +
			'.dvt-editor .dvt-alert-row select,.dvt-editor .dvt-alert-row input{width:auto;display:inline-block}' +
			'.dvt-editor .dvt-alert-row input{width:7em}' +
			'.dvt-editor .dvt-swatch{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #999}' +
			'.dvt-link-btn{background:none;border:0;padding:0;color:var(--dvt-accent,#2f7d4f);font-weight:600;font-size:13px;cursor:pointer;align-self:flex-start}' +
			'.dvt-editor .dvt-chart-choice{display:inline-flex;align-items:center;gap:4px;margin:0 4px;font-weight:normal;font-size:13px;white-space:nowrap}';
		var style = document.createElement('style');
		style.id = 'dvt-styles';
		style.textContent = css;
		document.head.appendChild(style);
	}

	function el(tag, className, text) {
		var e = document.createElement(tag);
		if (className) e.className = className;
		if (text !== undefined && text !== null) e.textContent = text;
		return e;
	}

	function two(n) { return (n < 10 ? '0' : '') + n; }

	// ---- reading values out of the telepathons ----

	function telepathonNamed(list, name) {
		for (var i = 0; i < list.length; i++) if (list[i] && list[i]["Name"] === name) return list[i];
		return null;
	}

	function deneNamed(telepathon, name) {
		var denes = (telepathon && telepathon["Denes"]) || [];
		for (var i = 0; i < denes.length; i++) if (denes[i]["Name"] === name) return denes[i];
		return null;
	}

	function wordIn(dene, name) {
		var words = (dene && dene["DeneWords"]) || [];
		for (var i = 0; i < words.length; i++) if (words[i]["Name"] === name) return words[i];
		return null;
	}

	// The dene word, in the named dene; with no dene, the first dene that has it.
	function findWord(telepathon, deneName, wordName) {
		if (!telepathon) return null;
		if (deneName) return wordIn(deneNamed(telepathon, deneName), wordName);
		var denes = telepathon["Denes"] || [];
		for (var i = 0; i < denes.length; i++) {
			var w = wordIn(denes[i], wordName);
			if (w) return w;
		}
		return null;
	}

	function isShowable(value) {
		return value === null || ['string', 'number', 'boolean'].indexOf(typeof value) >= 0;
	}

	// A tank's level colour, as on the Teleonome's card (deviceviews-card.js levelColor): Sensors
	// "<tank> Height", "Minimum <tank> Level", "Maximum <tank> Level", Purpose "<tank> Measured Height".
	function levelOf(telepathon, tank) {
		var sensors = deneNamed(telepathon, "Sensors"), purpose = deneNamed(telepathon, "Purpose");
		var height = wordIn(sensors, tank + " Height"), min = wordIn(sensors, "Minimum " + tank + " Level"),
			max = wordIn(sensors, "Maximum " + tank + " Level"), measured = wordIn(purpose, tank + " Measured Height");
		if (!height || !min || !max || !measured) return {color: 'Gray', level: null};
		var lo = parseFloat(min["Value"]), hi = parseFloat(max["Value"]);
		var level = parseFloat(height["Value"]) - parseFloat(measured["Value"]);
		if (isNaN(lo) || isNaN(hi) || isNaN(level)) return {color: 'Gray', level: null};
		return {color: level < lo ? 'Red' : level > hi ? 'Blue' : 'Green', level: level, units: height["Units"] || ''};
	}

	// The tanks a telepathon can show a level colour for: each "Minimum <tank> Level" in its Sensors dene.
	function tanksOf(telepathon) {
		var tanks = [];
		var words = (deneNamed(telepathon, "Sensors") || {})["DeneWords"] || [];
		words.forEach(function(w) {
			var m = /^Minimum (.+) Level$/.exec(w["Name"] || '');
			if (m && wordIn(deneNamed(telepathon, "Purpose"), m[1] + " Measured Height")) tanks.push(m[1]);
		});
		return tanks;
	}

	function formatValue(value) {
		if (value === null || value === undefined || value === '') return '—';
		if (typeof value === 'boolean') return value ? 'Yes' : 'No';
		var n = typeof value === 'number' ? value : (/^-?\d+(\.\d+)?$/.test(String(value).trim()) ? parseFloat(value) : null);
		if (n === null) return String(value);
		if (Number.isInteger(n)) return n.toLocaleString();
		return n.toLocaleString(undefined, {maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1});
	}

	// ---- the weather forecast: Annabelle's (deviceviews-weather.js) ----

	function hasWeather() { return typeof DeviceViewsWeather !== 'undefined'; }

	function forecastName(item) {
		if (item.what === 'min') return 'Minimum temperature ' + DAYS[item.day];
		if (item.what === 'max') return 'Maximum temperature ' + DAYS[item.day];
		return 'Temperature ' + DAYS[item.day] + ' at ' + two(item.hour) + ':00';
	}

	// What an item is, in words: {name, from}.
	function describe(item) {
		if (item.type === 'forecast') return {name: item.label || forecastName(item), from: 'Weather forecast'};
		if (item.type === 'level') return {name: item.label || item.tank + ' level', from: item.telepathon};
		return {name: item.label || item.word, from: item.telepathon + (item.dene ? ' › ' + item.dene : '')};
	}

	// ---- the pills, a tab, the editor ----

	function create(o) {
		addStyles();
		var tabs = o.tabs || [];
		var builtIn = o.builtIn || [];
		var active = null;
		var editing = null;   // the tab being made or changed: {id, name, items}
		var codeAsked = false;   // the host said no code was needed, but the save asked for one after all

		try { active = localStorage.getItem(o.storageKey) || null; } catch (e) {}

		function telepathons() { return (o.telepathons() || []).filter(Boolean); }

		function remember() {
			try { localStorage.setItem(o.storageKey, active); } catch (e) {}
		}

		function tabById(id) {
			for (var i = 0; i < tabs.length; i++) if (String(tabs[i].id) === String(id)) return tabs[i];
			return null;
		}

		function availableBuiltIns() {
			return builtIn.filter(function(b) { return !b.available || b.available(); });
		}

		// The pill to show: the one chosen before when it is still there, else the first.
		function settle() {
			var ids = availableBuiltIns().map(function(b) { return b.id; }).concat(hasWeather() ? [WEATHER_PILL] : [])
				.concat(tabs.map(function(t) { return 'tab-' + t.id; }));
			if (active === 'new' && o.canEdit) return;
			if (ids.indexOf(active) < 0) active = ids.length ? ids[0] : null;
		}

		function drawPills() {
			o.pills.textContent = '';
			o.pills.classList.add('dvt-pills');
			var all = availableBuiltIns().map(function(b) { return {id: b.id, name: b.name}; })
				.concat(hasWeather() ? [{id: WEATHER_PILL, name: 'Weather'}] : [])
				.concat(tabs.map(function(t) { return {id: 'tab-' + t.id, name: t.name}; }));
			all.forEach(function(p) {
				var b = el('button', 'dvt-pill' + (p.id === active && !editing ? ' dvt-on' : ''), p.name);
				b.type = 'button';
				b.setAttribute('aria-pressed', String(p.id === active && !editing));
				b.addEventListener('click', function() { editing = null; active = p.id; remember(); draw(); });
				o.pills.appendChild(b);
			});
			if (o.canEdit) {
				var add = el('button', 'dvt-pill dvt-new' + (editing && editing.id == null ? ' dvt-on' : ''), '+ New tab');
				add.type = 'button';
				add.addEventListener('click', function() { openEditor(null); });
				o.pills.appendChild(add);
			}
			// nothing to choose between: no pills
			o.pills.hidden = all.length + (o.canEdit ? 1 : 0) < 2 && !tabs.length;
		}

		function draw() {
			settle();
			drawPills();
			availableBuiltIns().forEach(function(b) { if (b.id !== active || editing) b.hide(); });
			builtIn.forEach(function(b) { if (b.available && !b.available()) b.hide(); });
			o.editor.hidden = !editing;
			var tab = !editing && active && active.indexOf('tab-') === 0 ? tabById(active.substring(4)) : null;
			var weather = !editing && active === WEATHER_PILL && hasWeather();
			o.view.hidden = !tab && !weather;
			if (editing) drawEditor();
			else if (weather) DeviceViewsWeather.render(o.view, telepathons());
			else if (tab) drawTab(tab);
			else availableBuiltIns().forEach(function(b) { if (b.id === active) b.show(); });
		}

		// ---- one tab: a tile per value ----
		function drawTab(tab) {
			var list = telepathons();
			o.view.textContent = '';
			var head = el('div', 'dvt-head');
			head.appendChild(el('h2', null, tab.name));
			if (o.canEdit) {
				var edit = el('button', 'btn btn-default btn-sm', 'Edit');
				edit.type = 'button';
				edit.addEventListener('click', function() { openEditor(tab); });
				head.appendChild(edit);
			}
			o.view.appendChild(head);
			if (!tab.items.length) {
				o.view.appendChild(el('p', 'dvt-empty', 'This tab shows nothing yet.' + (o.canEdit ? ' Press Edit to pick its values.' : '')));
				return;
			}
			var tiles = el('div', 'dvt-tiles');
			tab.items.forEach(function(item) { tiles.appendChild(tile(item, list)); });
			o.view.appendChild(tiles);
		}

		function tile(item, list) {
			var t = el('div', 'dvt-tile');
			var d = describe(item);
			var band = el('div', 'dvt-band');
			band.appendChild(el('div', 'dvt-name', d.name));
			band.appendChild(el('div', 'dvt-from', d.from));
			t.appendChild(band);
			// the heading in the colour of the first alert that holds, and why (not by colour alone)
			function alertOn(number, units) {
				var a = alertFor(item, number);
				if (!a) return;
				var c = ALERT_COLORS[a.color];
				band.classList.add('dvt-alert');
				band.style.background = c.bg;
				band.style.color = c.fg;
				band.appendChild(el('div', 'dvt-why', ALERT_OPS[a.op].charAt(0).toUpperCase() + ALERT_OPS[a.op].substring(1) + ' '
					+ formatValue(a.value) + (units ? ' ' + units : '')));
			}
			var value = el('div', 'dvt-value');
			t.appendChild(value);
			if (item.type === 'forecast') {
				var forecast = hasWeather() ? DeviceViewsWeather.find(list) : null;
				var f = forecast ? DeviceViewsWeather.value(forecast, item) : null;
				value.textContent = f ? formatValue(f.value) : '—';
				if (f) value.appendChild(el('span', 'dvt-units', f.units));
				if (f) alertOn(toNumber(f.value), f.units);
				if (!forecast) t.appendChild(el('div', 'dvt-age', 'No forecast from Annabelle yet'));
				else if (!f) t.appendChild(el('div', 'dvt-age', 'Not in the forecast (it covers 5 days, in 3-hour steps)'));
				else if (forecast.downloaded) t.appendChild(el('div', 'dvt-age', 'Downloaded ' + deviceViewsFormatAge(Math.max(0, Date.now() / 1000 - forecast.downloaded))));
				return t;
			}
			var telepathon = telepathonNamed(list, item.telepathon);
			if (!telepathon) {
				value.textContent = '—';
				t.appendChild(el('div', 'dvt-age', 'No data from ' + item.telepathon));
				return t;
			}
			if (item.type === 'level') {
				var lv = levelOf(telepathon, item.tank);
				var square = el('span', 'dvt-square');
				square.style.background = LEVEL_HEX[lv.color];
				if (lv.level !== null) square.title = formatValue(lv.level) + (lv.units ? ' ' + lv.units : '');
				value.appendChild(square);
				value.appendChild(document.createTextNode(lv.color === 'Gray' ? 'Unknown' : lv.color));
			} else {
				var w = findWord(telepathon, item.dene, item.word);
				value.textContent = w ? formatValue(w["Value"]) : '—';
				if (w && w["Units"]) value.appendChild(el('span', 'dvt-units', w["Units"]));
				if (w) alertOn(toNumber(w["Value"]), w["Units"]);
			}
			t.appendChild(age(telepathon));
			if (item.type === 'word' && item.charts && chartable(item.telepathon)) t.appendChild(chartButtons(item));
			return t;
		}

		function chartable(name) {
			return !o.canChart || o.canChart(name);
		}

		// The 1h / 24h / 7d buttons of a device's details (deviceviews-history.js answers their clicks, through
		// DeviceViewsHost.fetchHistory, so the chart popup is the same one).
		function chartButtons(item) {
			var holder = el('div', 'dvt-charts');
			[['1h', 3600000], ['24h', 86400000], ['7d', 604800000]].forEach(function(r) {
				var b = el('button', 'btn btn-xs btn-default telepathon-history-value', r[0]);
				b.type = 'button';
				b.setAttribute('data-telepathonname', item.telepathon);
				b.setAttribute('data-denename', item.dene || '');
				b.setAttribute('data-denewordname', item.word);
				b.setAttribute('data-range', String(r[1]));
				b.setAttribute('aria-label', r[0] + ' chart of ' + (item.label || item.word));
				holder.appendChild(b);
			});
			return holder;
		}

		// When the telepathon was last heard, coloured like its card.
		function age(telepathon) {
			var seconds = o.ageSeconds ? o.ageSeconds(telepathon["Name"]) : null;
			var color;
			if (seconds === null || seconds === undefined) {
				var s = computeTelepathonAgeStatus(telepathon);
				seconds = s.ageSeconds;
				color = s.statusColor;
			} else {
				color = seconds < 7200 ? '#27ae60' : seconds < 86400 ? '#f39c12' : '#e74c3c';
			}
			var a = el('div', 'dvt-age');
			var dot = el('span', 'dvt-dot');
			dot.style.background = color;
			a.appendChild(dot);
			a.appendChild(document.createTextNode(deviceViewsFormatAge(Math.max(0, seconds))));
			return a;
		}

		// ---- the editor: the tab's name and its values ----
		function openEditor(tab) {
			editing = tab ? {id: tab.id, name: tab.name, items: JSON.parse(JSON.stringify(tab.items))} : {id: null, name: '', items: []};
			draw();
			o.editor.scrollIntoView({behavior: 'smooth', block: 'start'});
		}

		function drawEditor() {
			var list = telepathons();
			var e = o.editor;
			e.textContent = '';
			e.classList.add('dvt-editor');
			e.appendChild(el('h2', null, editing.id == null ? 'New tab' : 'Change “' + editing.name + '”'));

			var nameLabel = el('label', null, 'Name');
			nameLabel.setAttribute('for', 'dvt-name');
			e.appendChild(nameLabel);
			var name = el('input', 'form-control');
			name.id = 'dvt-name';
			name.maxLength = 40;
			name.placeholder = 'e.g. Greenhouse';
			name.value = editing.name;
			name.addEventListener('input', function() { editing.name = name.value; });
			e.appendChild(name);

			e.appendChild(el('div', 'dvt-section', 'Values'));
			var rows = el('div');
			e.appendChild(rows);
			function drawRows() {
				rows.textContent = '';
				if (!editing.items.length) rows.appendChild(el('p', 'dvt-empty', 'None yet: add them below, from any device or the forecast.'));
				editing.items.forEach(function(item, i) {
					var row = el('div', 'dvt-row');
					var what = el('div', 'dvt-what');
					var plain = JSON.parse(JSON.stringify(item));
					plain.label = '';
					var d = describe(plain);
					what.appendChild(document.createTextNode(d.name));
					what.appendChild(el('small', null, d.from));
					row.appendChild(what);
					var label = el('input', 'form-control input-sm dvt-label');
					label.maxLength = 80;
					label.placeholder = 'Its own name (optional)';
					label.value = item.label || '';
					label.setAttribute('aria-label', 'Name shown for ' + d.name);
					label.addEventListener('input', function() { item.label = label.value; });
					row.appendChild(label);
					if (item.type === 'word' && chartable(item.telepathon)) {
						var choice = el('label', 'dvt-chart-choice');
						var box = el('input');
						box.type = 'checkbox';
						box.checked = !!item.charts;
						box.addEventListener('change', function() { item.charts = box.checked; });
						choice.appendChild(box);
						choice.appendChild(document.createTextNode('1h 24h 7d'));
						choice.title = 'Show the chart buttons under the value';
						row.appendChild(choice);
					}
					[['↑', 'Move up', -1], ['↓', 'Move down', 1]].forEach(function(m) {
						var b = el('button', 'btn btn-default btn-sm dvt-small-btn', m[0]);
						b.type = 'button';
						b.title = m[1];
						b.setAttribute('aria-label', m[1]);
						b.disabled = i + m[2] < 0 || i + m[2] >= editing.items.length;
						b.addEventListener('click', function() {
							var other = editing.items[i + m[2]];
							editing.items[i + m[2]] = item;
							editing.items[i] = other;
							drawRows();
						});
						row.appendChild(b);
					});
					var remove = el('button', 'btn btn-default btn-sm dvt-small-btn', '✕');
					remove.type = 'button';
					remove.title = 'Remove';
					remove.setAttribute('aria-label', 'Remove ' + d.name);
					remove.addEventListener('click', function() { editing.items.splice(i, 1); drawRows(); });
					row.appendChild(remove);
					if (item.type === 'word' || item.type === 'forecast') row.appendChild(alertRules(item));
					rows.appendChild(row);
				});
			}
			drawRows();

			// The value's colour rules, under it: "when below 5, Blue", first that holds wins.
			function alertRules(item) {
				var holder = el('div', 'dvt-alerts');
				function drawAlerts() {
					holder.textContent = '';
					(item.alerts || []).forEach(function(a, i) {
						var r = el('div', 'dvt-alert-row');
						r.appendChild(document.createTextNode(i === 0 ? 'Colour the heading when' : 'else when'));
						var op = el('select', 'form-control input-sm');
						op.setAttribute('aria-label', 'Comparison');
						Object.keys(ALERT_OPS).forEach(function(k) { op.appendChild(new Option(k.replace('<=', '\u2264').replace('>=', '\u2265') + ' (' + ALERT_OPS[k] + ')', k)); });
						op.value = a.op;
						op.addEventListener('change', function() { a.op = op.value; });
						r.appendChild(op);
						var v = el('input', 'form-control input-sm');
						v.type = 'number';
						v.step = 'any';
						v.value = typeof a.value === 'number' ? String(a.value) : '';
						v.setAttribute('aria-label', 'Value');
						v.addEventListener('input', function() { a.value = v.value === '' ? null : parseFloat(v.value); });
						r.appendChild(v);
						var swatch = el('span', 'dvt-swatch');
						var color = el('select', 'form-control input-sm');
						color.setAttribute('aria-label', 'Colour');
						Object.keys(ALERT_COLORS).forEach(function(k) { color.appendChild(new Option(ALERT_COLORS[k].name, k)); });
						color.value = a.color;
						function paint() { swatch.style.background = ALERT_COLORS[color.value].bg; }
						color.addEventListener('change', function() { a.color = color.value; paint(); });
						paint();
						r.appendChild(color);
						r.appendChild(swatch);
						var x = el('button', 'btn btn-default btn-sm dvt-small-btn', '\u2715');
						x.type = 'button';
						x.setAttribute('aria-label', 'Remove this colour rule');
						x.addEventListener('click', function() { item.alerts.splice(i, 1); drawAlerts(); });
						r.appendChild(x);
						holder.appendChild(r);
					});
					if ((item.alerts || []).length < MAX_ALERTS) {
						var add = el('button', 'dvt-link-btn', '+ Colour rule');
						add.type = 'button';
						add.addEventListener('click', function() {
							item.alerts = item.alerts || [];
							item.alerts.push({op: '<', value: null, color: item.alerts.length ? 'red' : 'blue'});
							drawAlerts();
							var inputs = holder.querySelectorAll('input');
							if (inputs.length) inputs[inputs.length - 1].focus();
						});
						holder.appendChild(add);
					}
				}
				drawAlerts();
				return holder;
			}

			// Add: first where from (a telepathon, or the forecast), then which value.
			e.appendChild(el('div', 'dvt-section', 'Add a value'));
			var add = el('div', 'dvt-add');
			var from = el('select', 'form-control');
			from.setAttribute('aria-label', 'From');
			from.appendChild(new Option('From…', ''));
			list.map(function(t) { return t["Name"]; }).sort().forEach(function(n) { from.appendChild(new Option(n, 't:' + n)); });
			from.appendChild(new Option('Weather forecast', 'forecast'));
			add.appendChild(from);
			var pick = el('div', 'dvt-add');
			pick.style.flex = '1 1 100%';
			pick.style.margin = '0';
			add.appendChild(pick);
			e.appendChild(add);

			// What is chosen in the picker but not added yet (2026-11-08: Save adds it, so a value picked without
			// pressing Add is not lost - the first Greenhouse tab was saved empty that way).
			var pending = function() { return null; };

			from.addEventListener('change', function() {
				pick.textContent = '';
				pending = function() { return null; };
				if (!from.value) return;
				if (from.value === 'forecast') return pickForecast(pick);
				pickWord(pick, telepathonNamed(list, from.value.substring(2)));
			});

			// Added: into the list above, and the picker starts again.
			function addItem(item) {
				editing.items.push(item);
				drawRows();
				from.value = '';
				pick.textContent = '';
				pending = function() { return null; };
			}

			function pickWord(holder, telepathon) {
				if (!telepathon) return;
				var select = el('select', 'form-control');
				select.setAttribute('aria-label', 'Value');
				var options = [];
				select.appendChild(new Option('Pick a value\u2026', ''));
				var tanks = tanksOf(telepathon);
				if (tanks.length) {
					var g = el('optgroup');
					g.label = 'Level colours';
					tanks.forEach(function(tank) {
						options.push({type: 'level', telepathon: telepathon["Name"], tank: tank, label: ''});
						g.appendChild(new Option(tank + ' level colour', String(options.length - 1)));
					});
					select.appendChild(g);
				}
				var denes = (telepathon["Denes"] || []).slice().sort(function(a, b) {
					function rank(d) { return d["Name"] === "Purpose" ? 0 : d["Name"] === "Sensors" ? 1 : 2; }
					return rank(a) - rank(b);
				});
				denes.forEach(function(dene) {
					if (dene["Name"] === 'Weather Forecast') return;   // the forecast is picked under "Weather forecast"
					var words = (dene["DeneWords"] || []).filter(function(w) { return w["Name"] && isShowable(w["Value"]); });
					if (!words.length) return;
					var g = el('optgroup');
					g.label = dene["Name"];
					words.forEach(function(w) {
						options.push({type: 'word', telepathon: telepathon["Name"], dene: dene["Name"], word: w["Name"], label: '',
							charts: chartable(telepathon["Name"])});
						var now = formatValue(w["Value"]) + (w["Units"] ? ' ' + w["Units"] : '');
						g.appendChild(new Option(w["Name"] + '  (' + now + ')', String(options.length - 1)));
					});
					select.appendChild(g);
				});
				if (!options.length) {
					holder.appendChild(el('p', 'dvt-empty', telepathon["Name"] + ' has no values to show yet.'));
					return;
				}
				holder.appendChild(select);
				pending = function() {
					var chosen = select.value === '' ? null : options[parseInt(select.value, 10)];
					return chosen ? JSON.parse(JSON.stringify(chosen)) : null;
				};
				holder.appendChild(addButton(function() {
					var chosen = pending();
					if (chosen) addItem(chosen);
				}));
			}

			function pickForecast(holder) {
				var what = el('select', 'form-control');
				what.setAttribute('aria-label', 'Which forecast');
				what.appendChild(new Option('Temperature at a time', 'temp'));
				what.appendChild(new Option('Minimum temperature of the day', 'min'));
				what.appendChild(new Option('Maximum temperature of the day', 'max'));
				var day = el('select', 'form-control');
				day.setAttribute('aria-label', 'Day');
				DAYS.forEach(function(d, i) { day.appendChild(new Option(d.charAt(0).toUpperCase() + d.substring(1), String(i))); });
				day.value = '1';
				var hour = el('select', 'form-control');
				hour.setAttribute('aria-label', 'Time');
				for (var h = 0; h < 24; h++) hour.appendChild(new Option(two(h) + ':00', String(h)));
				hour.value = '6';
				what.addEventListener('change', function() { hour.hidden = what.value !== 'temp'; });
				holder.appendChild(what);
				holder.appendChild(day);
				holder.appendChild(hour);
				pending = function() {
					return {type: 'forecast', what: what.value, day: parseInt(day.value, 10), hour: parseInt(hour.value, 10), label: ''};
				};
				holder.appendChild(addButton(function() { addItem(pending()); }));
			}

			function addButton(onAdd) {
				var b = el('button', 'btn btn-default', 'Add');
				b.type = 'button';
				b.addEventListener('click', onAdd);
				return b;
			}

			// Save, Cancel, Remove; the code first where the host asks for it.
			var actions = el('div', 'dvt-actions');
			var code = null;
			var askCode = codeAsked || (typeof o.needsCode === 'function' ? o.needsCode() : !!o.needsCode);
			if (askCode) {
				code = el('input', 'form-control dvt-code');
				code.inputMode = 'numeric';
				code.maxLength = 6;
				code.placeholder = 'Code';
				code.autocomplete = 'off';
				code.setAttribute('aria-label', 'Code from your authenticator app');
				actions.appendChild(code);
			}
			var save = el('button', 'btn btn-primary', 'Save');
			save.type = 'button';
			actions.appendChild(save);
			var cancel = el('button', 'btn btn-default', 'Cancel');
			cancel.type = 'button';
			actions.appendChild(cancel);
			var remove = null;
			if (editing.id != null) {
				remove = el('button', 'btn btn-danger', 'Remove tab');
				remove.type = 'button';
				remove.style.marginLeft = 'auto';
				actions.appendChild(remove);
			}
			e.appendChild(actions);
			if (askCode) e.appendChild(el('p', 'help-block', 'Saving needs the current code from your authenticator app.'));
			var message = el('p', 'dvt-message');
			e.appendChild(message);

			function busy(on) {
				[save, cancel, remove].forEach(function(b) { if (b) b.disabled = on; });
			}

			// Saving failed without a code box (the minutes without the code ran out): show the box.
			function failed(err) {
				if (!code && o.needsCode) {
					codeAsked = true;
					drawEditor();
					o.editor.querySelector('.dvt-message').textContent = err.message;
					var box = o.editor.querySelector('.dvt-code');
					if (box) box.focus();
				} else {
					message.textContent = err.message;
				}
			}

			function done(r, id) {
				codeAsked = false;
				tabs = r.tabs || tabs;
				editing = null;
				active = id == null ? null : 'tab-' + id;
				remember();
				draw();
			}

			save.addEventListener('click', function() {
				message.textContent = '';
				var n = editing.name.trim();
				if (!n) { message.textContent = 'Give the tab a name.'; name.focus(); return; }
				var notAdded = pending();
				if (notAdded) addItem(notAdded);
				editing.items.forEach(function(item) {
					if (item.alerts) item.alerts = item.alerts.filter(function(a) { return typeof a.value === 'number' && !isNaN(a.value); });
				});
				busy(true);
				o.save({id: editing.id, name: n, items: editing.items}, code ? code.value.trim() : '').then(function(r) {
					done(r, r.id != null ? r.id : editing.id);
				}).catch(failed).then(function() { busy(false); });
			});
			cancel.addEventListener('click', function() { editing = null; draw(); });
			if (remove) remove.addEventListener('click', function() {
				message.textContent = '';
				if (!window.confirm('Remove the tab “' + editing.name + '”?')) return;
				busy(true);
				o.remove(editing.id, code ? code.value.trim() : '').then(function(r) {
					done(r, null);
				}).catch(failed).then(function() { busy(false); });
			});
		}

		draw();

		return {
			// new telepathons: redraw what is showing (not the editor, so nothing typed is lost)
			refresh: function() { if (!editing) draw(); else drawPills(); },
			setTabs: function(t) { tabs = t || []; if (!editing) draw(); },
			// the host's own views changed (e.g. the map was switched off)
			redraw: draw
		};
	}

	return {create: create, forecastName: forecastName};
})();
