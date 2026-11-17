// deviceviews emergency (2026-11-17): the Emergency Channel banner, the same on every screen that shows the farm.
// On a Teleonome the organs publish one-shot alerts to the Heart topic "Emergency Channel" (today the Cerebellum:
// a registry telepathon gone missing, the Hypothalamus silent for 3 minutes). Each alert is its own red banner,
// newest first, until the person dismisses it; nothing is stored, so a reload starts with none.
//
// Payload (JSON): {"Sender": "...", "Message": "...", "TimestampMillis": <epoch ms>}; "Timestamp" as a ready string
// is accepted in place of TimestampMillis, lower-case keys too, and a payload that is not JSON is the message itself.
//
//   DeviceViewsEmergency.receive(payload)   one alert from the channel (a string or an object); draws the banners
//   DeviceViewsEmergency.dismiss(id)        removes one alert
//   DeviceViewsEmergency.messages()         the alerts shown now: [{id, sender, message, time}], newest first
//   DeviceViewsEmergency.html()             the banners as an HTML string ('' when there are none)
//   DeviceViewsEmergency.render()           draws them into every element with class "dv-emergency-banner"
//
// The host decides where the banners go (an element with class "dv-emergency-banner", outside anything it redraws)
// and how the alerts arrive: the Teleonome from its Heart (HeartComms.js), other hosts from their own source.
// It only shows what it is given and sends nothing. Text is escaped; the dismiss buttons work through one delegated
// click handler, so the HTML-string version works as well.

var DeviceViewsEmergency = (function() {
	var list = [];
	var counter = 0;

	function esc(s) {
		return String(s === undefined || s === null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
			.replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function parse(payload) {
		var sender = "Unknown", message = payload, time = null, p = payload;
		if (typeof p === "string") {
			try { p = JSON.parse(p); } catch (e) { p = null; }
		}
		if (p && typeof p === "object") {
			sender = p.Sender || p.sender || "Unknown";
			message = p.Message || p.message || (typeof payload === "string" ? payload : JSON.stringify(payload));
			var ms = p.TimestampMillis || p.timestampMillis;
			if (ms) time = new Date(parseInt(ms, 10)).toLocaleString();
			else if (p.Timestamp || p.timestamp) time = p.Timestamp || p.timestamp;
		}
		return { sender: sender, message: message, time: time || new Date().toLocaleString() };
	}

	function html() {
		return list.map(function(m) {
			return '<div class="alert alert-danger dv-emergency" role="alert" style="margin:8px 0;padding:10px 34px 10px 14px;position:relative;">'
				+ '<button type="button" class="close dv-emergency-dismiss" data-id="' + m.id + '" style="position:absolute;top:8px;right:12px;" title="Dismiss">&times;</button>'
				+ '<strong>&#9888; Emergency:</strong> ' + esc(m.message)
				+ '<div style="font-size:12px;margin-top:4px;opacity:0.8;">From <strong>' + esc(m.sender) + '</strong> at ' + esc(m.time) + '</div>'
				+ '</div>';
		}).join("");
	}

	function render() {
		var h = html(), els = document.querySelectorAll(".dv-emergency-banner");
		for (var i = 0; i < els.length; i++) els[i].innerHTML = h;
	}

	document.addEventListener("click", function(ev) {
		var b = ev.target && ev.target.closest ? ev.target.closest(".dv-emergency-dismiss") : null;
		if (!b) return;
		ev.preventDefault();
		DeviceViewsEmergency.dismiss(parseInt(b.getAttribute("data-id"), 10));
	});

	return {
		receive: function(payload) {
			var m = parse(payload);
			m.id = ++counter;
			list.unshift(m);
			render();
			return m;
		},
		dismiss: function(id) {
			list = list.filter(function(m) { return m.id !== id; });
			render();
		},
		messages: function() { return list.slice(); },
		html: html,
		render: render
	};
})();
