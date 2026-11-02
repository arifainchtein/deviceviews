// deviceviews: one look for a device, on the Teleonome and on devices.digitalstables.com (2026-10-31,
// DevicesDigitalStables design doc §18). Moved unchanged out of the Teleonome webapp (RenderingEngine.js,
// D3Chart.js, TimeUtils.js, TeleonomeConstants.js, index.html); what differs between the two hosts goes
// through DeviceViewsHost (deviceviews-base.js). Needs jQuery, Bootstrap 3 and d3 v7.

// A device's card (logo, name, last heard, its main values) and the detail popup it opens (moved from
// RenderingEngine.js). buildTelepathonCardView(telepathon) returns the card's HTML and creates or refreshes
// the popup #tpModal_<name>.
function computeTelepathonAgeStatus(telepathon) {
	var name = telepathon["Name"];
	var deviceType = DeviceViewsHost.deviceType(name) || '';
	var localTime = '';
	var purposeWords = [];
	var denes = telepathon["Denes"] || [];
	for (var di = 0; di < denes.length; di++) {
		if (denes[di]["Name"] === "Configuration") {
			var cws = denes[di]["DeneWords"] || [];
			for (var ci = 0; ci < cws.length; ci++) {
				if (cws[ci]["Name"] === "Device Type Id" && !deviceType) deviceType = cws[ci]["Value"];
			}
		}
		if (denes[di]["Name"] === "Purpose") {
			var pws = denes[di]["DeneWords"] || [];
			for (var pi = 0; pi < pws.length; pi++) {
				if (pws[pi]["Name"] === "Local Time") localTime = pws[pi]["Value"];
			}
			purposeWords = pws;
		}
	}
	function findPW(n) {
		for (var fi = 0; fi < purposeWords.length; fi++) if (purposeWords[fi]["Name"] === n) return purposeWords[fi];
		return null;
	}
	var opStatusDW = findPW("Operating Status");
	var opNum = opStatusDW ? String(parseInt(opStatusDW["Value"])) : null;
	var dataTimestampMs = (function() {
		var m = String(localTime || '').match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
		if (!m) return null;
		return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5]), parseInt(m[6])).getTime();
	})();
	var ageSeconds = (dataTimestampMs !== null ? (Date.now() - dataTimestampMs) : (Date.now() - DeviceViewsHost.pulseTimeMs())) / 1000;
	function rangeColor(green, yellow) {
		return ageSeconds < green ? '#27ae60' : (ageSeconds < yellow ? '#f39c12' : '#e74c3c');
	}
	var statusColor;
	if (name === "Chinampa" || deviceType === "Chinampa") {
		statusColor = rangeColor(120, 240);
	} else if (deviceType === "Annabelle") {
		// her status comes when something is new, and at least every 10 minutes (firmware 10)
		statusColor = rangeColor(720, 1500);
	} else if (deviceType === "Daffodil" || deviceType === "Langley") {
		if (opNum === "4") {
			var cloudySleepDW = findPW("Sleep Time");
			var cloudySleepSec = cloudySleepDW ? parseFloat(cloudySleepDW["Value"]) : null;
			statusColor = cloudySleepSec ?
				(ageSeconds <= cloudySleepSec ? '#27ae60' : (ageSeconds <= cloudySleepSec * 2 ? '#f39c12' : '#e74c3c')) :
				rangeColor(120, 240);
		} else {
			statusColor = rangeColor(120, 240);
		}
	} else {
		statusColor = rangeColor(60, 120);
	}
	return { ageSeconds: ageSeconds, statusColor: statusColor };
}

// idSuffix distinguishes a second rendering of the same device's card from the
// main Telepathons view's own (e.g. '_registry' for the Registry Status popup,
// which can show a device that's also currently live in the main grid) - without
// it, both would emit the same tpModal_/tpText_/tpCardCol_ ids and collide.
function buildTelepathonCardView(telepathon, idSuffix) {
	idSuffix = idSuffix || '';
	var name = telepathon["Name"];
	var safeId = name.replace(/[^a-zA-Z0-9]/g, '_') + idSuffix;
	var modalId = 'tpModal_' + safeId;

	// Prefer the live-packet cache over the denome value which can be stale/garbled.
	var deviceType = DeviceViewsHost.deviceType(name) || '';
	var localTime = '';
	var purposeWords = [];
	var sensorWords = [];
	var denes = telepathon["Denes"] || [];
	for (var di = 0; di < denes.length; di++) {
		if (denes[di]["Name"] === "Configuration") {
			var cws = denes[di]["DeneWords"] || [];
			for (var ci = 0; ci < cws.length; ci++) {
				if (cws[ci]["Name"] === "Device Type Id" && !deviceType) deviceType = cws[ci]["Value"];
			}
		}
		if (denes[di]["Name"] === "Purpose") {
			var pws = denes[di]["DeneWords"] || [];
			for (var pi = 0; pi < pws.length; pi++) {
				if (pws[pi]["Name"] === "Local Time") localTime = pws[pi]["Value"];
			}
			purposeWords = pws;
		}
		if (denes[di]["Name"] === "Sensors") {
			sensorWords = denes[di]["DeneWords"] || [];
		}
	}

	function findPW(n) {
		for (var fi = 0; fi < purposeWords.length; fi++) if (purposeWords[fi]["Name"] === n) return purposeWords[fi];
		return null;
	}
	function findSW(n) {
		for (var fi = 0; fi < sensorWords.length; fi++) if (sensorWords[fi]["Name"] === n) return sensorWords[fi];
		return null;
	}
	// heightDW is the sensor-mount height (Sensors dene, e.g. "Fish Tank Height"), measuredDW the
	// live air-gap reading (Purpose dene, e.g. "Fish Tank Measured Height") — level = heightDW -
	// measuredDW. minDW/maxDW are the acceptable-level thresholds, which live as their own
	// separate Sensors-dene DeneWords ("Minimum/Maximum Fish Tank Level", "Minimum/Maximum Sump
	// Trough Level") rather than as Minimum/Maximum attributes on heightDW itself — an earlier
	// version assumed the latter, which meant min/max were always NaN and this always fell back
	// to the caller's default color (masking real low-level alerts as green).
	function levelColor(heightDW, minDW, maxDW, measuredDW) {
		if (!heightDW || !minDW || !maxDW || !measuredDW) return null;
		var min = parseFloat(minDW["Value"]);
		var max = parseFloat(maxDW["Value"]);
		if (isNaN(min) || isNaN(max)) return null;
		var level = parseFloat(heightDW["Value"]) - parseFloat(measuredDW["Value"]);
		if (level < min) return 'Red';
		if (level > max) return 'Blue';
		return 'Green';
	}

	var opStatusDW = findPW("Operating Status");
	var opNum = opStatusDW ? String(parseInt(opStatusDW["Value"])) : null;

	var dataTimestampMs = (function() {
		var m = String(localTime || '').match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
		if (!m) return null;
		return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5]), parseInt(m[6])).getTime();
	})();
	var ageSeconds = (dataTimestampMs !== null ? (Date.now() - dataTimestampMs) : (Date.now() - DeviceViewsHost.pulseTimeMs())) / 1000;

	function rangeColor(green, yellow) {
		return ageSeconds < green ? '#27ae60' : (ageSeconds < yellow ? '#f39c12' : '#e74c3c');
	}

	var statusColor;
	if (name === "Chinampa" || deviceType === "Chinampa") {
		statusColor = rangeColor(120, 240);
	} else if (deviceType === "Annabelle") {
		// her status comes when something is new, and at least every 10 minutes (firmware 10)
		statusColor = rangeColor(720, 1500);
	} else if (deviceType === "Daffodil" || deviceType === "Langley") {
		if (opNum === "4") {
			var cloudySleepDW = findPW("Sleep Time");
			var cloudySleepSec = cloudySleepDW ? parseFloat(cloudySleepDW["Value"]) : null;
			statusColor = cloudySleepSec ?
				(ageSeconds <= cloudySleepSec ? '#27ae60' : (ageSeconds <= cloudySleepSec * 2 ? '#f39c12' : '#e74c3c')) :
				rangeColor(120, 240);
		} else {
			statusColor = rangeColor(120, 240);
		}
	} else {
		statusColor = rangeColor(60, 120);
	}

	// Build device-specific status info line
	var statusExtra = '';
	var opModeHtml = '';
	if (name === "Chinampa" || deviceType === "Chinampa") {
		var alertCodeDW = findPW("Alert Code");
		var ac = alertCodeDW ? parseInt(alertCodeDW["Value"]) : 99;
		var alertMsgs = {0:"Initializing...",1:"Fish Tank Data Stale",2:"Sump Trough Stale",3:"FT & Sump Data Stale",4:"Solenoid Open / Low Flow",5:"Sump Level Too Low",6:"System Low In Water"};
		if (ac !== 99) {
			opModeHtml = '<span style="display:block;background:#fadbd8;color:#000;font-weight:bold;padding:0 6px;border-radius:4px;">' + (alertMsgs[ac] || ("Alert Code " + ac)) + '</span>';
		} else {
			opModeHtml = '<span style="display:block;background:#d5f5e3;border-radius:4px;">&nbsp;</span>';
		}

		var fishColor = levelColor(findSW("Fish Tank Height"), findSW("Minimum Fish Tank Level"), findSW("Maximum Fish Tank Level"), findPW("Fish Tank Measured Height")) || 'Gray';
		var sumpColor = levelColor(findSW("Sump Trough Height"), findSW("Minimum Sump Trough Level"), findSW("Maximum Sump Trough Level"), findPW("Sump Trough Measured Height")) || 'Gray';
		var levelColorHexMap = {Red:'#e74c3c', Green:'#27ae60', Blue:'#2060ff', Gray:'#95a5a6'};
		var fishColorHex = levelColorHexMap[fishColor];
		var sumpColorHex = levelColorHexMap[sumpColor];

		var fishFlowDW = findPW("Fish Tank Outflow Flow Rate");
		var fishFlowStr = fishFlowDW ? (fishFlowDW["Value"] + (fishFlowDW["Units"] ? ' ' + fishFlowDW["Units"] : '')) : '—';
		var fishLabel = window.innerWidth < 768 ? 'F' : 'Fish';
		var sumpLabel = window.innerWidth < 768 ? 'S' : 'Sump';
		statusExtra = '<span style="font-size:11px;color:#555;">' + fishLabel + ': ' + fishFlowStr +
			'&nbsp;<span style="color:' + fishColorHex + ';font-weight:bold;">' + fishColor + '</span>' +
			'&nbsp;&nbsp;' + sumpLabel + ': <span style="color:' + sumpColorHex + ';font-weight:bold;">' + sumpColor + '</span></span>';
	} else {
		if ((deviceType === "Daffodil" || deviceType === "Langley") && opStatusDW) {
			var opLabel = daffodilOperatingStatusNames[opNum] || ('Mode ' + opNum);
			var sleepStr = '';
			if (opNum === "1" || opNum === "4" || opNum === "5") {
				var sleepDW = findPW("Sleep Time");
				if (sleepDW) sleepStr = ', ' + sleepDW["Value"] + (sleepDW["Units"] ? sleepDW["Units"] : 's');
			}
			opModeHtml = opLabel + sleepStr;
		}
		var battDW = findPW("Battery Voltage");
		var extras = [];
		if (deviceType === "Daffodil") {
			var battCurrDW = findPW("Battery Current");
			if (battDW) extras.push('B: ' + battDW["Value"] + 'V' + (battCurrDW ? ' ' + battCurrDW["Value"] + 'mA' : ''));
			var socVal = DeviceViewsHost.setting(name, DENEWORD_PULSE_TASK_BATTERY_SOC_LIVE);
			if (socVal !== null) extras.push(parseFloat(socVal).toFixed(1) + '%');
			var panelVoltDW = findPW("Panel Voltage");
			var panelCurrDW = findPW("Panel Current");
			if (panelVoltDW) extras.push('P: ' + panelVoltDW["Value"] + 'V' + (panelCurrDW ? ' ' + panelCurrDW["Value"] + 'mA' : ''));
		} else if (deviceType === "Langley") {
			var battCurrDW = findPW("Battery Current");
			if (battDW) extras.push('B: ' + battDW["Value"] + 'V' + (battCurrDW ? ' ' + battCurrDW["Value"] + 'mA' : ''));
			var solarVoltDW = findPW("Solar Voltage");
			var solarCurrDW = findPW("Solar Current");
			if (solarVoltDW) extras.push('P: ' + solarVoltDW["Value"] + 'V' + (solarCurrDW ? ' ' + solarCurrDW["Value"] + 'mA' : ''));
			var energizerVoltCardDW = findPW("Energizer Battery Voltage");
			if (energizerVoltCardDW) extras.push('E: ' + energizerVoltCardDW["Value"] + 'V');
		} else if (deviceType === "Annabelle") {
			var uptimeDW = findPW("Uptime");
			if (uptimeDW) extras.push('Up ' + deviceViewsFormatAge(parseFloat(uptimeDW["Value"])).replace(' ago', ''));
			var freeDW = findPW("Free Memory");
			if (freeDW) extras.push(Math.round(parseFloat(freeDW["Value"]) / 1024) + ' KB free');
		} else if (battDW) {
			extras.push(battDW["Value"] + 'V');
		}
		if (extras.length) statusExtra = extras.join('&nbsp;&nbsp;');
	}

	// Sensor/actuator line — sits between the "last pulse" line and the Status
	// line, and shows the device's currently-configured sensor(s)/actuator(s)
	// rather than the fixed power/battery readings covered by statusExtra.
	var sensorLineHtml = '';
	(function() {
		var parts = [];
		function addPart(label, dw) {
			if (!dw) return;
			var unit = dw["Units"] || '';
			parts.push((label ? label + ': ' : '') + dw["Value"] + (unit ? ' ' + unit : ''));
		}
		// 25x25 solid-color square in place of a numeric reading — same red/green/blue
		// low/normal/high bucketing as Daffodil.ino's DAFFODIL_WATER_TROUGH LED logic
		// (measured height vs. the Minimum/Maximum thresholds), already computed above as
		// fishColor/fishColorHex and sumpColor/sumpColorHex via levelColor(). The exact
		// measured value is still available on hover via the title attribute.
		function levelSquare(hex, valueDW) {
			var titleAttr = valueDW ? ' title="' + valueDW["Value"] + (valueDW["Units"] ? ' ' + valueDW["Units"] : '') + '"' : '';
			return '<span style="display:inline-block;width:25px;height:25px;background:' + hex +
				';border:1px solid #999;border-radius:3px;vertical-align:middle;"' + titleAttr + '></span>';
		}
		if (name === "Chinampa" || deviceType === "Chinampa") {
			var fishFlowValDW = findPW("Fish Tank Outflow Flow Rate");
			var fishFlowValStr = fishFlowValDW ? (fishFlowValDW["Value"] + (fishFlowValDW["Units"] ? ' ' + fishFlowValDW["Units"] : '')) : '';
			parts.push('Fish: ' + (fishFlowValStr ? fishFlowValStr + ' ' : '') + levelSquare(fishColorHex, findPW("Fish Tank Measured Height")));
			parts.push('Sump: ' + levelSquare(sumpColorHex, findPW("Sump Trough Measured Height")));
		} else if (deviceType === "Daffodil") {
			var flow1RateDW = findPW("Flow Rate 1");
			var flow2RateDW = findPW("Flow Rate 2");
			var tank1LevelDW = findPW("Tank 1 Water Level");
			var tank2LevelDW = findPW("Tank 2 Water Level");
			if (flow1RateDW) { var f1n = findSW("Flow 1 Name"); addPart(f1n ? f1n["Value"] : 'Flow 1', flow1RateDW); }
			if (flow2RateDW) { var f2n = findSW("Flow 2 Name"); addPart(f2n ? f2n["Value"] : 'Flow 2', flow2RateDW); }
			if (tank1LevelDW) { var t1n = findSW("Tank 1 Name"); addPart(t1n ? t1n["Value"] : 'Tank 1', tank1LevelDW); }
			if (tank2LevelDW) { var t2n = findSW("Tank 2 Name"); addPart(t2n ? t2n["Value"] : 'Tank 2', tank2LevelDW); }
			if (!parts.length) {
				// Functions without dedicated flow/tank fields (Septic Tank, Water
				// Trough, Temp & Soil Moisture, Light Detector, ...) - fall back to
				// whichever generic sensor reading is present.
				var genericFields = ["Sceptic Available", "Measured Height", "Outdoor Temperature", "Outdoor Humidity", "Light Level"];
				for (var gi = 0; gi < genericFields.length; gi++) {
					var gdw = findPW(genericFields[gi]) || findSW(genericFields[gi]);
					if (gdw) { addPart(genericFields[gi], gdw); break; }
				}
			}
		} else if (deviceType === "Langley") {
			addPart('Fence', findPW("Fence Voltage Avg"));
		} else if (deviceType === "Annabelle") {
			parts.push(annabelleWeatherSummary(purposeWords));
		}
		if (parts.length) {
			sensorLineHtml = parts.join('&nbsp;&nbsp;');
		}
	})();

	var detailHtml = buildTelepathonDetailView(telepathon, idSuffix, deviceType);

	function fetchChinampaLevelChart() {
		fetchChinampaLevelChartFor(telepathon, safeId);
	}

	if (!$('#' + modalId).length) {
		$('body').append(
			'<div class="modal fade" id="' + modalId + '" tabindex="-1" role="dialog">' +
			'<div class="modal-dialog modal-lg"><div class="modal-content">' +
			'<div class="modal-header">' +
			'<button type="button" class="close" onclick="closeModal(\'' + modalId + '\')">&times;</button>' +
			'<h4 class="modal-title">' + name + '</h4></div>' +
			'<div class="modal-body" id="' + modalId + 'Body"></div>' +
			'<div class="modal-footer">' +
			'<button type="button" class="btn btn-default" onclick="closeModal(\'' + modalId + '\')">Close</button>' +
			'</div></div></div>'
		);
		if (name === "Chinampa" || deviceType === "Chinampa") {
			// Fires the inline 24h Water Level chart (see buildChinampaContent/loadChinampaLevelChart)
			// as soon as the modal opens; kept fresh afterwards by the periodic staleness check below
			// (this handler alone would only ever fetch once, since it's bound only on first creation).
			$('#' + modalId).on('shown.bs.modal', fetchChinampaLevelChart);
		}
	}
	// The body is rebuilt on every pulse - remember which tab panes were open (top-level and
	// sub-tabs) and re-open them afterwards, so the view doesn't jump back to the first tab.
	var openPaneIds = $('#' + modalId + 'Body .tab-pane.active').map(function() { return this.id; }).get();
	$('#' + modalId + 'Body').html(detailHtml);
	openPaneIds.forEach(function(paneId) {
		if (!paneId) return;
		var pane = document.getElementById(paneId);
		if (!pane || !$(pane).closest('#' + modalId + 'Body').length) return;
		$(pane).addClass('active').siblings('.tab-pane').removeClass('active');
		$('#' + modalId + 'Body li').filter(function() {
			var oc = this.getAttribute('onclick') || '';
			return oc.indexOf("'" + paneId + "'") >= 0;
		}).addClass('active').siblings('li').removeClass('active');
	});

	if (name === "Chinampa" || deviceType === "Chinampa") {
		// Runs on every refresh (every incoming pulse), not just modal creation/open — but only
		// actually re-fetches while the modal is visibly open and the cached chart (re-injected by
		// buildChinampaContent every rebuild — see its comment) is missing or stale. Keeps the
		// inline chart's data reasonably current without firing a Hippocampus_Request every pulse.
		var isModalOpen = $('#' + modalId).hasClass('in');
		var cached = window.chinampaLevelChartCache && window.chinampaLevelChartCache['chinampa-level-chart-' + safeId];
		var isStale = !cached || (Date.now() - cached.ts) > 120000;
		if (isModalOpen && isStale) fetchChinampaLevelChart();
	}

	var imgSrc = DeviceViewsHost.logoUrl(deviceType);

	var html = '<div class="col-xs-12 col-sm-6 col-md-4" id="tpCardCol_' + safeId + '" style="margin-bottom:16px;padding:6px;">';
	html += '<div style="border-radius:12px;border:1px solid #ddd;overflow:hidden;cursor:pointer;' +
		'box-shadow:0 2px 8px rgba(0,0,0,0.08);background:white;display:flex;align-items:stretch;" ' +
		'onclick="openModal(\'' + modalId + '\')">';
	html += '<div style="flex:0 0 110px;background:white;padding:10px;display:flex;align-items:center;' +
		'justify-content:center;border-right:1px solid #eee;position:relative;">';
	html += '<img src="' + imgSrc + '" style="width:90px;height:90px;object-fit:contain;" onerror="this.style.display=\'none\'">';
	html += deviceViewsNoGpsBadge(telepathon);
	html += '</div>';
	var cardAgeSec = Math.floor(ageSeconds);
	// Six lines on every card, whatever the device (2026-11-02, Ari): name, warning, time, sensors, mode,
	// power/status. Each has a fixed height, is centred and never wraps (too long ends in "..."), and an
	// empty one keeps its place, so every card is the same height.
	function cardLine(heightPx, content, extraStyle) {
		return '<div style="height:' + heightPx + 'px;line-height:' + heightPx + 'px;text-align:center;white-space:nowrap;' +
			'overflow:hidden;text-overflow:ellipsis;' + (extraStyle || '') + '">' + (content || '&nbsp;') + '</div>';
	}
	html += '<div id="tpText_' + safeId + '" style="flex:1;min-width:0;padding:10px 12px;background:#fafafa;display:flex;flex-direction:column;justify-content:center;">';
	// Daffodil "Op Mode" = opMode bit0 = USB programming jumper fitted - flag it on the card itself
	// (not just the detail popup) since left on it drains the battery overnight.
	var usbJumperCardDW = deviceType === "Daffodil" ? findPW("Op Mode") : null;
	var usbJumperOn = usbJumperCardDW && (String(usbJumperCardDW["Value"]).toLowerCase() === 'true' || String(usbJumperCardDW["Value"]) === '1');
	// 1. the name (red while the USB header is connected)
	html += usbJumperOn ?
		cardLine(24, '<span style="background:#c62828;color:#fff;border-radius:4px;padding:1px 8px;">' + name + '</span>', 'font-weight:bold;font-size:16px;') :
		cardLine(24, name, 'font-weight:bold;font-size:16px;color:#2c3e50;');
	// 2. warnings, only while something is wrong: the USB header; a real reset (red for 24 h for faults like
	// BROWNOUT/PANIC/WDT, orange for only 1 h for a plain power-on such as a flash or replug). Radio delivery
	// moved to the Diagnostics tab (Radio, Delivery) on 2026-11-02.
	var badges = [];
	if (usbJumperOn) badges.push('<span style="background:#c62828;color:#fff;border-radius:4px;padding:0 6px;">USB header connected</span>');
	if (deviceType === "Daffodil" || deviceType === "Langley") {
		var vsWords = [];
		for (var vdi = 0; vdi < denes.length; vdi++) if (denes[vdi]["Name"] === TELEPATHON_DENE_VITAL_SIGNS) vsWords = denes[vdi]["DeneWords"] || [];
		var vsVal = function(n) {
			for (var vwi = 0; vwi < vsWords.length; vwi++) if (vsWords[vwi]["Name"] === n) return vsWords[vwi]["Value"];
			return null;
		};
		var resetReason = vsVal("Last Reset Reason");
		var resetTime = parseInt(vsVal("Last Reset Time"));
		if (resetReason && resetTime > 0) {
			var resetAgeSec = Date.now() / 1000 - resetTime;
			var resetBadgeSec = VITAL_SIGNS_BAD_RESETS[resetReason] ? 86400 : 3600;
			if (resetAgeSec >= 0 && resetAgeSec < resetBadgeSec) {
				var resetAgeStr = resetAgeSec < 3600 ? Math.round(resetAgeSec / 60) + ' min' : Math.round(resetAgeSec / 3600) + ' h';
				var resetBg = VITAL_SIGNS_BAD_RESETS[resetReason] ? '#c62828' : '#e67e22';
				badges.push('<span style="background:' + resetBg + ';color:#fff;border-radius:4px;padding:0 6px;">&#9888; Reset ' + resetAgeStr + ' ago (' + resetReason + ')</span>');
			}
		}
	}
	html += cardLine(18, badges.join(' '), 'font-size:11px;font-weight:bold;');
	// 3. when
	var timeLine = '';
	if (localTime) {
		var localTimeRaw = String(localTime);
		var localTimeShort = localTimeRaw.replace(/^\d{4}\//, '');
		if (window.innerWidth < 768) {
			var dm = localTimeRaw.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(.*)$/);
			if (dm) {
				var now = new Date();
				var todayStr = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0');
				var dateStr = dm[1] + '/' + dm[2] + '/' + dm[3];
				if (dateStr === todayStr) localTimeShort = dm[4];
			}
		}
		timeLine = localTimeShort + '&nbsp;<span id="tpAge_' + safeId + '" style="color:' + statusColor + ';font-weight:bold;">(' + cardAgeSec + 's ago)</span>';
	}
	html += cardLine(18, timeLine, 'font-size:12px;color:#888;');
	// 4. sensors (Chinampa's 25 px level squares need the height), 5. mode or alert, 6. power / status
	html += cardLine(28, sensorLineHtml, 'font-size:13px;color:#444;');
	html += cardLine(18, opModeHtml, 'font-size:11px;color:#555;');
	html += cardLine(18, statusExtra, 'font-size:11px;color:#555;');
	html += '</div>';
	html += '</div>';
	html += '</div>';
	return html;
}

// The detail view on its own (2026-11-01): what the card's popup shows (Daffodil, Langley, Chinampa or the
// generic one), as HTML, for a host that shows it as the page itself (devices.digitalstables.com/d/<serial
// number>) instead of in a popup. The card uses it too, so the page and the popup are always the same.
function buildTelepathonDetailView(telepathon, idSuffix, deviceType) {
	var name = telepathon["Name"];
	var safeId = name.replace(/[^a-zA-Z0-9]/g, '_') + (idSuffix || '');
	if (deviceType === undefined) deviceType = deviceViewsTypeOf(telepathon);
	return deviceViewsNoGpsBanner(telepathon) + ((name === "Chinampa" || deviceType === "Chinampa") ? buildChinampaContent(telepathon, safeId) :
		deviceType === "Daffodil" ? buildDaffodilContent(telepathon) :
		deviceType === "Langley" ? buildLangleyContent(telepathon) :
		deviceType === "Annabelle" ? buildAnnabelleContent(telepathon) :
		buildTelepathonDetailContent(telepathon));
}

// Chinampa's inline 24h water level chart (Fish Tank and Sump Trough), into its container in the detail view
// (moved out of buildTelepathonCardView on 2026-11-01 so a page showing the detail without a popup can ask too).
function fetchChinampaLevelChartFor(telepathon, safeId) {
	var purposeWords = [], sensorWords = [];
	(telepathon["Denes"] || []).forEach(function(d) {
		if (d["Name"] === "Purpose") purposeWords = d["DeneWords"] || [];
		if (d["Name"] === "Sensors") sensorWords = d["DeneWords"] || [];
	});
	function find(words, n) {
		for (var i = 0; i < words.length; i++) if (words[i]["Name"] === n) return words[i];
		return null;
	}
	function numOrNaN(dw) { return dw ? parseFloat(dw["Value"]) : NaN; }
	var ftMeasuredDW = find(purposeWords, "Fish Tank Measured Height");
	var stMeasuredDW = find(purposeWords, "Sump Trough Measured Height");
	loadChinampaLevelChart(telepathon["Name"], 'chinampa-level-chart-' + safeId, [
		{
			dwName: "Fish Tank Measured Height",
			units: ftMeasuredDW ? (ftMeasuredDW["Units"] || '') : '',
			dash: '', // solid = Fish
			heightValue: numOrNaN(find(sensorWords, "Fish Tank Height")),
			minValue: numOrNaN(find(sensorWords, "Minimum Fish Tank Level")),
			maxValue: numOrNaN(find(sensorWords, "Maximum Fish Tank Level"))
		},
		{
			dwName: "Sump Trough Measured Height",
			units: stMeasuredDW ? (stMeasuredDW["Units"] || '') : '',
			dash: '6,4', // dashed = Sump
			heightValue: numOrNaN(find(sensorWords, "Sump Trough Height")),
			minValue: numOrNaN(find(sensorWords, "Minimum Sump Trough Level")),
			maxValue: numOrNaN(find(sensorWords, "Maximum Sump Trough Level"))
		}
	]);
}

// For a page that shows the detail view itself (no popup): call once its HTML is in the page, to start what
// the popup would start when it opens (today only Chinampa's water level chart).
function startTelepathonDetailView(telepathon, idSuffix) {
	var name = telepathon["Name"];
	if (name === "Chinampa" || deviceViewsTypeOf(telepathon) === "Chinampa") {
		fetchChinampaLevelChartFor(telepathon, name.replace(/[^a-zA-Z0-9]/g, '_') + (idSuffix || ''));
	}
}

// A telepathon's device type: what the host says, else its Configuration dene's "Device Type Id" (2026-11-01).
function deviceViewsTypeOf(telepathon) {
	var deviceType = DeviceViewsHost.deviceType(telepathon["Name"]) || '';
	var denes = telepathon["Denes"] || [];
	for (var di = 0; di < denes.length && !deviceType; di++) {
		if (denes[di]["Name"] !== "Configuration") continue;
		var cws = denes[di]["DeneWords"] || [];
		for (var ci = 0; ci < cws.length; ci++) {
			if (cws[ci]["Name"] === "Device Type Id") { deviceType = String(cws[ci]["Value"]); break; }
		}
	}
	return deviceType;
}

// Annabelle's weather forecast in a few words, coloured: when it last went out, or that it did not (2026-11-01).
function annabelleWeatherSummary(purposeWords) {
	function pw(n) {
		for (var i = 0; i < purposeWords.length; i++) if (purposeWords[i]["Name"] === n) return purposeWords[i]["Value"];
		return null;
	}
	// Annabelle's clock is not UTC: the age at the reading (on her own clock), plus the time since the reading
	var ageAtReading = parseInt(pw("Weather Forecast Age"));
	var readingTime = parseInt(pw("Seconds Time"));
	var result = String(pw("Weather Forecast Result") || "");
	if (isNaN(ageAtReading) || ageAtReading < 0) return '<span style="color:#e67e22;">Weather: none sent yet</span>';
	var age = ageAtReading + Math.max(0, Date.now() / 1000 - (readingTime || Date.now() / 1000));
	var sent = String(pw("Weather Forecast Sent")) === "true";
	var color = !sent ? '#e74c3c' : (age > 6 * 3600 ? '#e67e22' : '#27ae60');
	return '<span style="color:' + color + ';">Weather ' + (sent ? 'sent ' : 'NOT sent ') + deviceViewsFormatAge(age) + '</span>'
		+ (sent ? '' : '<br><span style="font-size:11px;color:#e74c3c;">' + result.replace(/^not sent: /, '') + '</span>');
}
