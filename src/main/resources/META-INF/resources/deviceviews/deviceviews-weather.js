// deviceviews weather (2026-11-12): the farm's weather forecast, the same on the Teleonome and on
// devices.digitalstables.com. It never downloads one: Annabelle downloads it from OpenWeather (at most once an
// hour, one DigitalStables key) and sends its first 24 hours to the field devices over LoRa. Her whole 5-day
// forecast goes to the Pi over serial, where the framework's WeatherForecastDeserializer makes it the
// "Weather Forecast" dene of her telepathon. That telepathon goes on to devices.digitalstables.com like every
// reading, so every screen shows the forecast the field devices were sent.
//
// The dene's words: Provider, Downloaded (epoch s), Time Zone Offset (s east of UTC, the farm's), Slot Count,
// Columns ("dt,temperature,humidity,cloudiness,pressure,rain,pop,wind,code") and Forecast (a JSON array of
// arrays in Columns order: one per OpenWeather 3-hour slot; dt UTC epoch s, C, %, %, hPa, mm in 3 h,
// chance of rain %, wind m/s, OpenWeather condition id).
//
//   DeviceViewsWeather.find(telepathons)        the newest forecast among them, or null:
//       {provider, downloaded, timezoneOffset, from (telepathon name), slots: [{dt, temperature, ...}]}
//   DeviceViewsWeather.render(element, telepathons)   the Weather view: a card per day, its 3-hour slots
//       (drawn again on each refresh, keeping the day that was chosen)
//   DeviceViewsWeather.html(telepathons, {title: false})   the same view as an HTML string (deviceviews-detail.js)
//   DeviceViewsWeather.value(forecast, item)    a tab's forecast item ({what: temp|min|max, day: 0..4, hour}):
//       {value, units} or null
//   DeviceViewsWeather.DAYS                     the day names an item's "day" means
//
// Times are the farm's (the forecast's time zone), not the viewer's. Plain DOM, text with textContent only;
// the day buttons work through one delegated click handler, so the HTML-string version works as well.

var DeviceViewsWeather = (function() {

	var DENE = "Weather Forecast";
	var STALE_SECONDS = 3 * 3600;   // she downloads hourly: three hours old means something is wrong
	var DAYS = ["today", "tomorrow", "the day after", "in 3 days", "in 4 days"];
	var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

	// ---- reading the dene ----

	function words(dene) {
		var m = {};
		((dene && dene["DeneWords"]) || []).forEach(function(w) { if (w && w["Name"]) m[w["Name"]] = w["Value"]; });
		return m;
	}

	function parse(telepathon) {
		var denes = (telepathon && telepathon["Denes"]) || [];
		var dene = null;
		for (var i = 0; i < denes.length; i++) if (denes[i] && denes[i]["Name"] === DENE) dene = denes[i];
		if (!dene) return null;
		var w = words(dene);
		var rows;
		try { rows = typeof w["Forecast"] === "string" ? JSON.parse(w["Forecast"]) : w["Forecast"]; } catch (e) { return null; }
		if (!Array.isArray(rows) || !rows.length) return null;
		var columns = String(w["Columns"] || "dt,temperature,humidity,cloudiness,pressure,rain,pop,wind,code").split(",");
		var slots = [];
		rows.forEach(function(r) {
			if (!Array.isArray(r)) return;
			var s = {};
			columns.forEach(function(c, i) { s[c.trim()] = typeof r[i] === "number" ? r[i] : parseFloat(r[i]); });
			if (s.dt > 0) slots.push(s);
		});
		if (!slots.length) return null;
		slots.sort(function(a, b) { return a.dt - b.dt; });
		return {
			provider: w["Provider"] || "OpenWeather",
			downloaded: parseFloat(w["Downloaded"]) || null,
			timezoneOffset: parseFloat(w["Time Zone Offset"]) || 0,
			from: telepathon["Name"] || "",
			slots: slots
		};
	}

	function find(telepathons) {
		var best = null;
		(telepathons || []).forEach(function(t) {
			var f = parse(t);
			if (f && (!best || (f.downloaded || 0) > (best.downloaded || 0))) best = f;
		});
		return best;
	}

	// ---- the farm's time ----

	// The forecast's own time zone: an epoch read as UTC after adding the offset.
	function local(f, epochSeconds) {
		var d = new Date((epochSeconds + f.timezoneOffset) * 1000);
		return {
			key: d.getUTCFullYear() + "-" + two(d.getUTCMonth() + 1) + "-" + two(d.getUTCDate()),
			weekday: WEEKDAYS[d.getUTCDay()], date: d.getUTCDate(), month: MONTHS[d.getUTCMonth()],
			hour: d.getUTCHours(), minute: d.getUTCMinutes()
		};
	}

	function two(n) { return (n < 10 ? "0" : "") + n; }

	// The farm's local midnight that starts the day dayIndex days from today, as an epoch.
	function dayStart(f, dayIndex) {
		var now = Date.now() / 1000;
		var shifted = now + f.timezoneOffset;
		var midnight = Math.floor(shifted / 86400) * 86400 - f.timezoneOffset;
		return midnight + dayIndex * 86400;
	}

	// The cards: first the next 24 hours (2026-11-12, Ari: 8 three-hour slots, what the field devices are sent
	// over LoRa - "today" alone was only what was left of it, e.g. 5 slots at 11:00), then one per day from
	// tomorrow. Each: {key, label, sub, slots, min, max, rain, pop, wind, code}.
	function days(f) {
		var byKey = {}, out = [];
		var todayKey = local(f, Date.now() / 1000).key;
		f.slots.forEach(function(s) {
			var l = local(f, s.dt);
			var day = byKey[l.key];
			if (!day) {
				day = byKey[l.key] = {key: l.key, slots: [], label: l.weekday, sub: l.date + " " + l.month};
				out.push(day);
			}
			day.slots.push(s);
		});
		out = out.filter(function(d) { return d.key > todayKey; });
		var now = Date.now() / 1000;
		var next = f.slots.filter(function(s) { return s.dt + 3 * 3600 > now; }).slice(0, 8);
		if (next.length) {
			var first = local(f, next[0].dt);
			out.unshift({key: "next24", slots: next, label: "Next 24 h", sub: "from " + two(first.hour) + ":" + two(first.minute)});
		}
		out.forEach(function(day) {
			day.min = Math.min.apply(null, day.slots.map(function(s) { return s.temperature; }));
			day.max = Math.max.apply(null, day.slots.map(function(s) { return s.temperature; }));
			day.rain = day.slots.reduce(function(sum, s) { return sum + (s.rain || 0); }, 0);
			day.pop = Math.max.apply(null, day.slots.map(function(s) { return s.pop || 0; }));
			day.wind = Math.max.apply(null, day.slots.map(function(s) { return s.wind || 0; }));
			day.code = worst(day.slots);
		});
		return out;
	}

	// ---- OpenWeather condition ids, in words ----

	function condition(code) {
		code = Math.round(code || 0);
		if (code >= 200 && code < 300) return {text: "Thunderstorm", icon: "⛈️", rank: 7};
		if (code >= 300 && code < 400) return {text: "Drizzle", icon: "🌦️", rank: 4};
		if (code === 500) return {text: "Light rain", icon: "🌦️", rank: 5};
		if (code >= 500 && code < 600) return {text: code === 511 ? "Freezing rain" : "Rain", icon: "🌧️", rank: 6};
		if (code >= 600 && code < 700) return {text: "Snow", icon: "❄️", rank: 8};
		if (code >= 700 && code < 800) return {text: code === 741 ? "Fog" : code === 771 || code === 781 ? "Squalls" : "Haze", icon: "🌫️", rank: 3};
		if (code === 800) return {text: "Clear", icon: "☀️", rank: 0};
		if (code === 801 || code === 802) return {text: "Partly cloudy", icon: "⛅", rank: 1};
		if (code > 802 && code < 900) return {text: "Cloudy", icon: "☁️", rank: 2};
		return {text: "—", icon: "", rank: -1};
	}

	function worst(slots) {
		var best = 0, rank = -2;
		slots.forEach(function(s) { var c = condition(s.code); if (c.rank > rank) { rank = c.rank; best = s.code; } });
		return best;
	}

	// ---- a tab's forecast item ----

	function value(f, item) {
		if (!f || !item) return null;
		var start = dayStart(f, item.day || 0), end = start + 86400;
		if (item.what === "min" || item.what === "max") {
			var temps = f.slots.filter(function(s) { return s.dt >= start && s.dt < end; }).map(function(s) { return s.temperature; });
			if (!temps.length) return null;
			return {value: round1(item.what === "min" ? Math.min.apply(null, temps) : Math.max.apply(null, temps)), units: "°C"};
		}
		// the temperature at that hour, between the two 3-hour slots around it
		var at = start + (item.hour || 0) * 3600;
		for (var i = 0; i < f.slots.length; i++) {
			var s = f.slots[i];
			if (s.dt === at) return {value: round1(s.temperature), units: "°C"};
			var n = f.slots[i + 1];
			if (n && s.dt < at && n.dt > at) {
				return {value: round1(s.temperature + (n.temperature - s.temperature) * (at - s.dt) / (n.dt - s.dt)), units: "°C"};
			}
		}
		return null;
	}

	function round1(n) { return Math.round(n * 10) / 10; }

	// ---- the view ----

	function addStyles() {
		if (typeof document === "undefined" || document.getElementById("dvw-styles")) return;
		var css =
			'.dvw{color:var(--dvt-text,#1d2420)}' +
			'.dvw-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;margin:0 0 12px}' +
			'.dvw-head h2{margin:0;font-size:18px;font-weight:700}' +
			'.dvw-source{font-size:12px;color:var(--dvt-muted,#5f6b64)}' +
			'.dvw-stale{color:#b9770e;font-weight:600}' +
			'.dvw-days{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;margin:0 0 12px}' +
			'.dvw-day{font:inherit;text-align:left;border:1px solid transparent;border-radius:10px;background:var(--dvt-tile,#f0f4f1);' +
			'  color:inherit;padding:8px 10px;cursor:pointer;min-width:0}' +
			'.dvw-day.dvw-on{border-color:var(--dvt-accent,#2f7d4f);box-shadow:0 0 0 1px var(--dvt-accent,#2f7d4f) inset}' +
			'.dvw-day .dvw-when{font-size:13px;font-weight:700}' +
			'.dvw-day .dvw-date{font-size:11px;color:var(--dvt-muted,#5f6b64);font-weight:400;margin-left:4px}' +
			'.dvw-day .dvw-cond{font-size:12px;margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
			'.dvw-day .dvw-temps{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}' +
			'.dvw-day .dvw-min{color:var(--dvt-muted,#5f6b64);font-weight:600;font-size:14px;margin-left:4px}' +
			'.dvw-day .dvw-rain{font-size:12px;color:#1b4f72}' +
			'.dvw-day .dvw-dry{color:var(--dvt-muted,#5f6b64)}' +
			'.dvw-frost{display:inline-block;font-size:10px;font-weight:700;color:#1b4f72;background:#d6eaf8;border-radius:4px;padding:0 4px;margin-left:4px;vertical-align:middle}' +
			'.dvw-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}' +
			'.dvw-hours{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}' +
			'.dvw-hours th{font-size:11px;font-weight:600;color:var(--dvt-muted,#5f6b64);text-align:right;padding:4px 6px;white-space:nowrap;border-bottom:1px solid var(--dvt-line,#e3e7e4)}' +
			'.dvw-hours td{text-align:right;padding:5px 6px;white-space:nowrap;border-bottom:1px solid var(--dvt-line,#e3e7e4)}' +
			'.dvw-hours th:first-child,.dvw-hours td:first-child,.dvw-hours th:nth-child(6),.dvw-hours td:nth-child(6){text-align:left}' +
			'.dvw-note{font-size:12px;color:var(--dvt-muted,#5f6b64);margin:8px 0 0}' +
			'.dvw-empty{color:var(--dvt-muted,#5f6b64);margin:4px 0}';
		var style = document.createElement("style");
		style.id = "dvw-styles";
		style.textContent = css;
		document.head.appendChild(style);
		// the day buttons, wherever the view is (also when it came as an HTML string)
		document.addEventListener("click", function(e) {
			var b = e.target && e.target.closest ? e.target.closest(".dvw-day") : null;
			if (!b) return;
			var root = b.closest(".dvw");
			if (!root) return;
			e.preventDefault();
			select(root, b.getAttribute("data-day"));
		});
	}

	function select(root, key) {
		Array.prototype.forEach.call(root.querySelectorAll(".dvw-day"), function(d) {
			var on = d.getAttribute("data-day") === key;
			d.classList.toggle("dvw-on", on);
			d.setAttribute("aria-pressed", String(on));
		});
		Array.prototype.forEach.call(root.querySelectorAll(".dvw-slots"), function(t) {
			t.hidden = t.getAttribute("data-day") !== key;
		});
	}

	function el(tag, className, text) {
		var e = document.createElement(tag);
		if (className) e.className = className;
		if (text !== undefined && text !== null) e.textContent = text;
		return e;
	}

	function temp(n) { var r = Math.round(n); return (r === 0 ? 0 : r) + "°"; }   // whole degrees, never "-0°"
	function kmh(ms) { return Math.round((ms || 0) * 3.6); }
	function mm(n) { return n >= 10 ? Math.round(n) + "" : (Math.round(n * 10) / 10).toFixed(1); }

	function ago(seconds) {
		if (typeof deviceViewsFormatAge === "function") return deviceViewsFormatAge(seconds);
		var m = Math.round(seconds / 60);
		return m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
	}

	function build(telepathons, options) {
		addStyles();
		var root = el("div", "dvw");
		var f = find(telepathons);
		var head = el("div", "dvw-head");
		if (!options || options.title !== false) head.appendChild(el("h2", null, "Weather"));
		root.appendChild(head);
		if (!f) {
			root.appendChild(el("p", "dvw-empty", "No forecast yet. Annabelle sends it after her next download from OpenWeather (at most an hour)."));
			return root;
		}
		var age = f.downloaded ? Math.max(0, Date.now() / 1000 - f.downloaded) : null;
		var source = el("div", "dvw-source", f.provider + (age === null ? "" : ", downloaded " + ago(age)) + (f.from ? " by " + f.from : ""));
		if (age !== null && age > STALE_SECONDS) source.appendChild(el("span", "dvw-stale", " — not updated for " + Math.floor(age / 3600) + " hours"));
		head.appendChild(source);

		var list = days(f);
		if (!list.length) {
			root.appendChild(el("p", "dvw-empty", "The forecast has run out: nothing from today on."));
			return root;
		}
		var cards = el("div", "dvw-days");
		list.forEach(function(day, i) {
			var c = condition(day.code);
			var b = el("button", "dvw-day" + (i === 0 ? " dvw-on" : ""));
			b.type = "button";
			b.setAttribute("data-day", day.key);
			b.setAttribute("aria-pressed", String(i === 0));
			var when = el("div", "dvw-when", day.label);
			when.appendChild(el("span", "dvw-date", day.sub));
			b.appendChild(when);
			var cond = el("div", "dvw-cond");
			if (c.icon) { var ic = el("span", null, c.icon + " "); ic.setAttribute("aria-hidden", "true"); cond.appendChild(ic); }
			cond.appendChild(document.createTextNode(c.text));
			b.appendChild(cond);
			var temps = el("div", "dvw-temps", temp(day.max));
			temps.appendChild(el("span", "dvw-min", temp(day.min)));
			if (day.min <= 2) temps.appendChild(el("span", "dvw-frost", "Frost"));
			b.appendChild(temps);
			b.appendChild(day.rain >= 0.1
				? el("div", "dvw-rain", mm(day.rain) + " mm, " + Math.round(day.pop) + "%")
				: el("div", "dvw-rain dvw-dry", Math.round(day.pop) > 0 ? "Dry, " + Math.round(day.pop) + "%" : "Dry"));
			cards.appendChild(b);
		});
		root.appendChild(cards);

		list.forEach(function(day, i) {
			var holder = el("div", "dvw-slots dvw-scroll");
			holder.setAttribute("data-day", day.key);
			holder.hidden = i !== 0;
			var table = el("table", "dvw-hours");
			var caption = el("caption", null, day.label + " " + day.sub + ", every 3 hours");
			caption.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
			table.appendChild(caption);
			var hr = el("tr");
			["Time", "Cloud", "Temp", "Rain", "Chance", "Sky", "Wind", "Humidity", "Pressure"].forEach(function(h) {
				var th = el("th", null, h);
				th.scope = "col";
				hr.appendChild(th);
			});
			var thead = el("thead");
			thead.appendChild(hr);
			table.appendChild(thead);
			var tbody = el("tbody");
			day.slots.forEach(function(s) {
				var l = local(f, s.dt), c = condition(s.code);
				var tr = el("tr");
				// the next 24 hours cross midnight: the day with the time
				[(day.key === "next24" ? l.weekday + " " : "") + two(l.hour) + ":" + two(l.minute), Math.round(s.cloudiness) + "%", temp(s.temperature),
					(s.rain || 0) >= 0.05 ? mm(s.rain) + " mm" : "—", Math.round(s.pop || 0) + "%", (c.icon ? c.icon + " " : "") + c.text,
					kmh(s.wind) + " km/h", Math.round(s.humidity) + "%", Math.round(s.pressure) + " hPa"
				].forEach(function(v) { tr.appendChild(el("td", null, v)); });
				tbody.appendChild(tr);
			});
			table.appendChild(tbody);
			holder.appendChild(table);
			root.appendChild(holder);
		});
		var last = f.slots[f.slots.length - 1];
		root.appendChild(el("p", "dvw-note", "Times are the farm's. Rain is over each 3 hours. \u201CNext 24 h\u201D is what the field devices get over LoRa; the forecast runs to "
			+ local(f, last.dt).weekday + " " + two(local(f, last.dt).hour) + ":00."));
		return root;
	}

	function render(element, telepathons, options) {
		var chosen = element.querySelector(".dvw-day.dvw-on");
		var key = chosen ? chosen.getAttribute("data-day") : null;
		element.textContent = "";
		var root = build(telepathons, options);
		element.appendChild(root);
		if (key && root.querySelector('.dvw-day[data-day="' + key + '"]')) select(root, key);
	}

	function html(telepathons, options) {
		return build(telepathons, options).outerHTML;
	}

	return {find: find, render: render, html: html, value: value, DAYS: DAYS, DENE: DENE};
})();
