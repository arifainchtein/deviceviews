// deviceviews: one look for a device, on the Teleonome and on devices.digitalstables.com (2026-10-31,
// DevicesDigitalStables design doc §18). Moved unchanged out of the Teleonome webapp (RenderingEngine.js,
// D3Chart.js, TimeUtils.js, TeleonomeConstants.js, index.html); what differs between the two hosts goes
// through DeviceViewsHost (deviceviews-base.js). Needs jQuery, Bootstrap 3 and d3 v7.

// The detail popup's content per device type (moved from RenderingEngine.js): the Diagnostics sub-tabs,
// firmware and identity, vital signs, then Daffodil, Langley, the generic one for any other device, and
// Chinampa.
// Diagnostics tab split into sub-tabs: "Vital Signs" (first, from buildVitalSignsPanel),
// "Hardware" (the device's own diagnostic DeneWords that used to sit above the vital signs) and,
// when given, "Identity" (buildDeviceIdentityPanel).
function buildDiagnosticsSubTabs(idPrefix, vitalSignsHtml, hardwareHtml, identityHtml) {
	var subPillStyle = 'font-size:12px;padding:3px 9px;';
	var html = '<ul class="nav nav-pills" style="margin-bottom:8px;flex-wrap:wrap;">';
	html += '<li class="active" onclick="return teleonomeShowTab(\'' + idPrefix + '-vital\', this)"><a href="#" style="' + subPillStyle + '">Vital Signs</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'' + idPrefix + '-hardware\', this)"><a href="#" style="' + subPillStyle + '">Hardware</a></li>';
	if (identityHtml) html += '<li onclick="return teleonomeShowTab(\'' + idPrefix + '-identity\', this)"><a href="#" style="' + subPillStyle + '">Identity</a></li>';
	html += '</ul>';
	html += '<div class="tab-content">';
	html += '<div class="tab-pane active" id="' + idPrefix + '-vital">' + vitalSignsHtml + '</div>';
	html += '<div class="tab-pane" id="' + idPrefix + '-hardware">' + hardwareHtml + '</div>';
	if (identityHtml) html += '<div class="tab-pane" id="' + idPrefix + '-identity">' + identityHtml + '</div>';
	html += '</div>';
	return html;
}

// Firmware source links (2026-10-07). Export Compiled Binary (DigitalStablesWatchDir) commits the
// sketch, pushes it and cuts a GitHub release tagged with the bare release number ("51") on
// github.com/arifainchtein/<repo>, so a firmware label "<repo> v<N>" maps to .../tree/<N>.
// The build stamp (YYMMDDhh, compile time) has no exact mapping - it links to the repo's commits
// up to the end of that day; the "Release vN" commit just after the build time is the one.
var GITHUB_FIRMWARE_OWNER = "arifainchtein";
function firmwareBuildDate(stamp) {
	var s = String(stamp || "");
	if (!/^\d{8}$/.test(s)) return null;
	return new Date(2000 + parseInt(s.substr(0, 2), 10), parseInt(s.substr(2, 2), 10) - 1,
		parseInt(s.substr(4, 2), 10), parseInt(s.substr(6, 2), 10), 0, 0);
}
function firmwareBuildText(stamp) {
	var d = firmwareBuildDate(stamp);
	if (!d) return String(stamp);
	function p2(n) { return (n < 10 ? '0' : '') + n; }
	return stamp + ' (' + p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p2(d.getHours()) + ':00)';
}
function firmwareCommitsUrl(repo, stamp, branch) {
	var d = firmwareBuildDate(stamp);
	if (!repo || !d) return null;
	d.setDate(d.getDate() + 1);  // "until" = end of the build day
	function p2(n) { return (n < 10 ? '0' : '') + n; }
	return 'https://github.com/' + GITHUB_FIRMWARE_OWNER + '/' + repo + '/commits/' + (branch || 'main') +
		'/?until=' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
// "Daffodil v51" -> {repo: "Daffodil", release: "51", url: ".../Daffodil/tree/51"}, else null
function firmwareReleaseFromLabel(label) {
	var m = /^\s*(\S+)\s+v(\d+)\s*$/i.exec(String(label || ""));
	if (!m) return null;
	return { repo: m[1], release: m[2], url: 'https://github.com/' + GITHUB_FIRMWARE_OWNER + '/' + m[1] + '/tree/' + m[2] };
}
// The release a build stamp belongs to, from the telepathon's Device Identity: only when that
// identity's label is current AND describes this exact build. Else null (caller falls back to the
// commits-by-day link). Release tags can share a commit (an export with no changes), so the commits
// list can't name the release - the label can.
function firmwareReleaseForBuild(telepathon, stamp) {
	var denes = (telepathon && telepathon["Denes"]) || [];
	for (var i = 0; i < denes.length; i++) {
		if (denes[i]["Name"] !== "Device Identity") continue;
		var words = denes[i]["DeneWords"] || [], w = {};
		for (var wi = 0; wi < words.length; wi++) w[words[wi]["Name"]] = words[wi]["Value"];
		if (String(w["Firmware Label Current"]) !== "true" || String(w["Firmware Build"]) !== String(stamp)) return null;
		return firmwareReleaseFromLabel(w["Firmware Label"]);
	}
	return null;
}
// "Build 55" linking to the release's code when known, else the stamp linking to commits by day.
function firmwareBuildHtml(telepathon, stamp, repo, branch) {
	var release = firmwareReleaseForBuild(telepathon, stamp);
	if (release) {
		return externalLink(release.url, 'Build ' + release.release) +
			' <span class="text-muted" style="font-weight:normal;">(' + firmwareBuildText(stamp).replace(/^\d+ \((.*)\)$/, '$1') + ')</span>';
	}
	var url = firmwareCommitsUrl(repo, stamp, branch);
	return url ? externalLink(url, firmwareBuildText(stamp)) : firmwareBuildText(stamp);
}
function externalLink(url, text) {
	return '<a href="' + url + '" target="_blank" rel="noopener">' + text + ' <span class="glyphicon glyphicon-new-window" style="font-size:10px;"></span></a>';
}

// Device identity - the "Device Identity" Dene (DeviceIdentityDeserializer.java, 2026-10-07):
// product definition + firmware label, and whether that label describes the running build.
// repo/branch: GitHub repo for the build-stamp link when the label can't be used.
function buildDeviceIdentityPanel(telepathon, repo, branch) {
	var denes = telepathon["Denes"] || [];
	var idDene = null;
	for (var i = 0; i < denes.length; i++) {
		if (denes[i]["Name"] === "Device Identity") idDene = denes[i];
	}
	var html = '<div style="margin-top:12px;font-size:11px;text-transform:uppercase;font-weight:bold;color:#2c3e50;border-bottom:1px solid #eee;margin-bottom:6px;padding-bottom:4px;">Device Identity</div>';
	if (!idDene) {
		return html + '<p class="text-muted" style="font-size:12px;">No device identity received yet (needs firmware that sends it - after a reset, after a deploy, and once a day).</p>';
	}
	var words = idDene["DeneWords"] || [];
	function val(name) {
		for (var wi = 0; wi < words.length; wi++) if (words[wi]["Name"] === name) return words[wi]["Value"];
		return null;
	}
	function row(label, valueHtml) {
		return '<tr><td style="width:40%;">' + label + '</td><td><strong>' + (valueHtml === null || valueHtml === '' ? '—' : valueHtml) + '</strong></td></tr>';
	}
	function epochToLocal(v) {
		var n = parseInt(v);
		return n > 0 ? new Date(n * 1000).toLocaleString() : '—';
	}
	var label = val("Firmware Label");
	var build = val("Firmware Build");
	var current = String(val("Firmware Label Current")) === "true";
	var release = firmwareReleaseFromLabel(label);
	var firmwareHtml = label || '';
	if (current && release) {
		firmwareHtml = externalLink(release.url, label) + ' <span style="color:#27ae60;font-weight:normal;">(current)</span>';
	} else if (label) {
		firmwareHtml = '<span style="color:#e67e22;">' + label + '</span> <span style="color:#e67e22;font-weight:normal;">(not confirmed - flashed without updating the label)</span>';
	}
	var buildHtml = firmwareBuildHtml(telepathon, build, release ? release.repo : repo, branch);

	html += '<table class="table table-condensed table-striped" style="margin-bottom:0;font-size:12px;">';
	html += row('Product Definition', val("Product Definition"));
	html += row('Firmware', firmwareHtml);
	html += row('Running Build', buildHtml);
	html += row('PCBs', val("PCBs"));
	html += row('Power Source', val("Power Source"));
	html += row('Battery', val("Battery"));
	html += row('Commissioned', epochToLocal(val("Commission Date")));
	html += row('Last Reported', epochToLocal(val("Device Identity Received Time")) + ' <span class="text-muted" style="font-weight:normal;">(' + (val("Identity Reason") || '') + ')</span>');
	html += '</table>';
	return html;
}

// repo/branch (optional): GitHub repo of the device's firmware, to link the build stamp.
function buildVitalSignsPanel(telepathon, tpName, i2cBitNames, repo, branch) {
	var denes = telepathon["Denes"] || [];
	var vitalDene = null;
	for (var i = 0; i < denes.length; i++) {
		if (denes[i]["Name"] === TELEPATHON_DENE_VITAL_SIGNS) vitalDene = denes[i];
	}
	var html = '<div style="margin-top:12px;font-size:11px;text-transform:uppercase;font-weight:bold;color:#2c3e50;border-bottom:1px solid #eee;margin-bottom:6px;padding-bottom:4px;">Vital Signs</div>';
	if (!vitalDene) {
		return html + '<p class="text-muted" style="font-size:12px;">No vital signs received yet (needs firmware that sends them).</p>';
	}
	var words = vitalDene["DeneWords"] || [];
	function dw(name) {
		for (var wi = 0; wi < words.length; wi++) if (words[wi]["Name"] === name) return words[wi];
		return null;
	}
	function graphBtns(dwName) {
		var d = 'data-telepathonname="' + tpName + '" data-denename="' + TELEPATHON_DENE_VITAL_SIGNS + '" data-denewordname="' + dwName + '"';
		var btnCls = 'btn btn-xs btn-default telepathon-history-value';
		return '<button class="' + btnCls + '" ' + d + ' data-range="86400000">24h</button> ' +
			'<button class="' + btnCls + '" ' + d + ' data-range="604800000">7d</button>';
	}
	function row(label, dwName, opts) {
		var w = dw(dwName);
		if (!w) return '';
		opts = opts || {};
		var val = opts.format ? opts.format(w["Value"]) : w["Value"];
		var units = w["Units"] && !opts.noUnits ? ' ' + w["Units"] : '';
		var style = opts.color ? ' style="color:' + opts.color + ';"' : '';
		return '<tr><td style="width:40%;">' + label + '</td><td><strong' + style + '>' + val + units + '</strong></td>' +
			'<td style="text-align:right;white-space:nowrap;padding:2px 4px;">' + (opts.noGraph ? '' : graphBtns(dwName)) + '</td></tr>';
	}
	// Each group is its own small table in an auto-fill grid (2026-10-08): side by side on a wide
	// screen instead of one long full-width table, stacked on a phone.
	function group(title, rowsHtml) {
		if (!rowsHtml) return '';
		return '<div style="min-width:0;"><table class="table table-condensed table-striped" style="margin-bottom:0;font-size:12px;">' +
			'<tr><td colspan="3" style="background:#f4f6f8;font-weight:bold;font-size:11px;">' + title + '</td></tr>' + rowsHtml + '</table></div>';
	}
	function epochToLocal(v) {
		var n = parseInt(v);
		return n > 0 ? new Date(n * 1000).toLocaleString() : '—';
	}
	var reasonDW = dw("Last Reset Reason");
	var reasonColor = reasonDW && VITAL_SIGNS_BAD_RESETS[reasonDW["Value"]] ? '#e74c3c' : (reasonDW && reasonDW["Value"] === "POWERON" ? '#e67e22' : null);

	var receivedDW = dw("Vital Signs Received Time");
	html += '<div style="margin-bottom:6px;font-size:12px;">Hypnogram: ' +
		'<button class="btn btn-xs btn-primary vital-signs-hypnogram" data-telepathonname="' + tpName + '" data-hours="24">24h</button> ' +
		'<button class="btn btn-xs btn-primary vital-signs-hypnogram" data-telepathonname="' + tpName + '" data-hours="168">7d</button>' +
		(receivedDW ? ' <span class="text-muted" style="margin-left:8px;">Last record: ' + epochToLocal(receivedDW["Value"]) + '</span>' : '') + '</div>';
	html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0 12px;align-items:start;">';
	html += group('Resets',
		row('Last Reset Reason', 'Last Reset Reason', { noGraph: true, color: reasonColor }) +
		row('Last Reset Time', 'Last Reset Time', { noGraph: true, format: epochToLocal }) +
		row('Reset Count', 'Reset Count'));
	html += group('Sleep',
		row('Wakes', 'Wake Count') +
		row('Aborted Wakes (low battery)', 'Aborted Wake Count') +
		row('Early Wakes (watchdog)', 'Early Wake Count') +
		row('Awake', 'Awake Percent') +
		row('Last Wake Cause', 'Last Wake Cause', { noGraph: true }) +
		row('Last Wake Drift', 'Last Wake Drift') +
		row('Last Awake Duration', 'Last Awake Duration'));
	html += group('Power',
		row('Wake Voltage', 'Wake Voltage') +
		row('Lowest TX Voltage', 'TX Min Voltage') +
		row('Battery Sag', 'Battery Sag') +
		row('Min Voltage Since Report', 'Min Voltage Since Report'));
	// Vital Signs v3 (2026-10-12): running totals since the last reset, integrated on the device
	// while awake. Only present for firmware that sends version 3 - group() hides it otherwise.
	html += group('Battery Ledger (since reset)',
		row('Charge In', 'Charge In Total') +
		row('Discharge Out', 'Discharge Out Total') +
		row('Panel Energy', 'Panel Energy Total') +
		row('Coverage of Awake Time', 'Ledger Coverage') +
		row('Longest Sample Gap', 'Ledger Max Gap') +
		row('Battery Temperature', 'Battery Temperature'));
	// Vital Signs v4 (2026-10-14): what WiFi costs - the same ledger, counted only while WiFi was on.
	html += group('WiFi (since reset)',
		row('Time On', 'WiFi On Seconds', { noUnits: true, format: function(v) {
			var s = parseInt(v);
			return isNaN(s) ? v : (s >= 3600 ? Math.floor(s / 3600) + ' h ' : '') + Math.floor((s % 3600) / 60) + ' min';
		} }) +
		row('Battery Charge Out', 'WiFi Charge Out') +
		row('Average Draw While On', 'WiFi Average Current'));
	// Power Profile Dene (sent with Device Identity): the battery/sensor facts the SOC uses.
	var ppWords = [];
	for (var pi2 = 0; pi2 < denes.length; pi2++) if (denes[pi2]["Name"] === "Power Profile") ppWords = denes[pi2]["DeneWords"] || [];
	if (ppWords.length) {
		var ppRows = '';
		["Battery Chemistry", "Cells In Series", "Battery Capacity", "Absorption Voltage", "Cutoff Voltage",
		 "Battery Current Resolution", "Panel Current Resolution", "Sleep Current", "Battery Temperature Source"].forEach(function(n) {
			for (var pw = 0; pw < ppWords.length; pw++) if (ppWords[pw]["Name"] === n) {
				ppRows += '<tr><td style="width:40%;">' + n + '</td><td colspan="2"><strong>' + ppWords[pw]["Value"] +
					(ppWords[pw]["Units"] ? ' ' + ppWords[pw]["Units"] : '') + '</strong></td></tr>';
			}
		});
		html += group('Power Profile', ppRows);
	}
	html += group('Last LoRa Transmit',
		row('Duration', 'TX Duration') +
		row('Battery Before', 'TX Battery Pre') +
		row('Battery Peak', 'TX Battery Peak') +
		row('Battery After', 'TX Battery Post') +
		row('Panel Current', 'TX Panel Current') +
		row('V50_I', 'TX V50I'));
	html += group('Radio',
		row('Delivery', 'Delivery Percent') +
		row('Records Missed', 'Records Missed') +
		row('TX Failures', 'LoRa TX Fail Count') +
		row('RSSI', 'Vital Signs RSSI') +
		row('SNR', 'Vital Signs SNR'));
	var maskDW = dw("I2C Device Mask");
	if (i2cBitNames && maskDW) {
		var mask = parseInt(maskDW["Value"]);
		var sensors = '';
		for (var bi = 0; bi < i2cBitNames.length; bi++) {
			var found = (mask >> bi) & 1;
			sensors += '<tr><td style="width:40%;">' + i2cBitNames[bi] + '</td><td colspan="2"><strong style="color:' + (found ? '#27ae60' : '#e74c3c') + ';">' + (found ? 'Found' : 'Missing') + '</strong></td></tr>';
		}
		html += group('Sensors', sensors);
	}
	// Firmware: shown only when there's no Device Identity - the Identity sub-tab already has the
	// label, build and link. "Last record" moved up next to the hypnogram buttons.
	var hasIdentity = false;
	for (var di = 0; di < denes.length; di++) if (denes[di]["Name"] === "Device Identity") hasIdentity = true;
	if (!hasIdentity) {
		html += group('Firmware',
			row('Build', 'Firmware Build', { noGraph: true, format: function(v) {
				return firmwareBuildHtml(telepathon, v, repo, branch);
			} }));
	}
	html += '</div>';
	return html;
}

function buildDaffodilContent(telepathon) {
	var denes = telepathon["Denes"] || [];
	var purposeDene = null, configDene = null, sensorsDene = null;
	for (var i = 0; i < denes.length; i++) {
		if (denes[i]["Name"] === "Purpose") purposeDene = denes[i];
		else if (denes[i]["Name"] === "Configuration") configDene = denes[i];
		else if (denes[i]["Name"] === "Sensors") sensorsDene = denes[i];
	}
	function getDW(dene, name) {
		if (!dene) return null;
		var dws = dene["DeneWords"] || [];
		for (var di = 0; di < dws.length; di++) {
			if (dws[di]["Name"] === name) return { value: dws[di]["Value"], units: dws[di]["Units"] || "" };
		}
		return null;
	}
	function getVal(dene, name, fallbackDene) {
		var r = getDW(dene, name);
		var dn = r ? dene["Name"] : null;
		if (!r && fallbackDene) { r = getDW(fallbackDene, name); dn = r ? fallbackDene["Name"] : null; }
		return r ? { value: r.value, units: r.units, deneName: dn } : null;
	}
	function mkGraphBtns(tpName, deneName, dwName, nucleus) {
		var nucleusAttr = nucleus ? ' data-nucleus="' + nucleus + '"' : '';
		var d = 'data-telepathonname="' + tpName + '" data-denename="' + deneName + '" data-denewordname="' + dwName + '"' + nucleusAttr;
		var btnCls = 'btn btn-xs btn-default telepathon-history-value';
		return '<button class="' + btnCls + '" ' + d + ' data-range="3600000">1h</button> ' +
			'<button class="' + btnCls + '" ' + d + ' data-range="86400000">24h</button> ' +
			'<button class="' + btnCls + ' hidden-xs" ' + d + ' data-range="604800000">7d</button>';
	}
	// Combined multi-series chart button group — fires N Hippocampus history requests at once
	// (one per DeneWord in dwNames) that get buffered client-side and drawn on one shared chart.
	// See displayHippocampusResponse's multi-request buffering and showTelepathonMultiGraph
	// (D3Chart.js) for the receiving/rendering side.
	function mkMultiGraphBtns(tpName, deneName, dwNames, dwUnits, chartTitle) {
		var d = 'data-telepathonname="' + tpName + '" data-denename="' + deneName + '"' +
			' data-denewordnames="' + dwNames.join(',') + '" data-denewordunits="' + dwUnits.join(',') + '"' +
			' data-title="' + chartTitle + '"';
		var btnCls = 'btn btn-xs btn-primary telepathon-multi-history-value';
		return '<button class="' + btnCls + '" ' + d + ' data-range="3600000">1h</button> ' +
			'<button class="' + btnCls + '" ' + d + ' data-range="86400000">24h</button> ' +
			'<button class="' + btnCls + ' hidden-xs" ' + d + ' data-range="604800000">7d</button>';
	}
	function multiChartPanel(chartTitle, dwNames, dwUnits) {
		return '<div style="margin-bottom:8px;padding:6px 8px;background:#eef3fa;border-radius:6px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;">' +
			'<span style="font-size:12px;font-weight:bold;color:#2c3e50;margin-right:4px;">' + chartTitle + '</span>' +
			mkMultiGraphBtns(tpName, 'Purpose', dwNames, dwUnits, chartTitle) +
			'</div>';
	}
	// Same blue panel as multiChartPanel, but holds several titled button-groups side by side
	// (each with its own 1h/24h/7d combined-chart buttons) instead of a separate blue line per chart.
	function multiChartPanelGroup(items) {
		var groups = items.map(function(it) {
			return '<span style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-right:22px;">' +
				'<span style="font-size:12px;font-weight:bold;color:#2c3e50;margin-right:4px;">' + it.title + '</span>' +
				mkMultiGraphBtns(tpName, 'Purpose', it.dwNames, it.dwUnits, it.title) +
				'</span>';
		}).join('');
		return '<div style="margin-bottom:8px;padding:6px 8px;background:#eef3fa;border-radius:6px;display:flex;align-items:center;flex-wrap:wrap;">' +
			groups +
			'</div>';
	}

	// ── LED snapshot helpers ──────────────────────────────────────────────────
	function ledSvg(onMap) {
		var W = 310, H = 190, R = 18, c = '';
		for (var i = 0; i < 15; i++) {
			var col = i % 5, row = Math.floor(i / 5);
			var x = 31 + col * 50, y = 35 + row * 58;
			var clr = onMap[i] || null;
			if (clr) {
				c += '<circle cx="'+x+'" cy="'+y+'" r="'+(R+8)+'" fill="'+clr+'" opacity="0.18"/>';
				c += '<circle cx="'+x+'" cy="'+y+'" r="'+(R+3)+'" fill="'+clr+'" opacity="0.30"/>';
				c += '<circle cx="'+x+'" cy="'+y+'" r="'+R+'" fill="'+clr+'"/>';
			} else {
				c += '<circle cx="'+x+'" cy="'+y+'" r="'+R+'" fill="#1a1a2e" stroke="#2d2d4a" stroke-width="1.5"/>';
			}
		}
		return '<svg viewBox="0 0 '+W+' '+H+'" style="width:90px;height:auto;border-radius:6px;display:block;margin:0 auto;">'
			+ '<rect width="'+W+'" height="'+H+'" rx="10" fill="#0c0c1a"/>' + c + '</svg>';
	}
	function snapPanel(title, svgHtml, subtitle) {
		return '<div style="text-align:center;padding:4px 6px;">' + svgHtml
			+ '<div style="color:#aaa;font-size:10px;margin-top:5px;text-transform:uppercase;letter-spacing:0.5px;">' + title + '</div>'
			+ (subtitle ? '<div style="color:#fff;font-size:11px;font-weight:bold;margin-top:2px;">' + subtitle + '</div>' : '')
			+ '</div>';
	}
	function computeBatLeds() {
		var m = {};
		var bv = getDW(purposeDene, 'Battery Voltage');
		var bc = getDW(purposeDene, 'Battery Current');
		var wf = getDW(purposeDene, 'Weather Fresh');
		var os = getDW(purposeDene, 'Operating Status');
		var voltage = bv ? parseFloat(bv.value) : 0;
		var current = bc ? parseFloat(bc.value) : 0;
		var fresh   = wf ? String(wf.value).toLowerCase() === 'true' : false;
		var opNum   = os ? parseInt(os.value) : 0;
		var batClr  = voltage >= 3.28 ? '#2060ff' : voltage >= 3.18 ? '#00e050' : voltage >= 3.10 ? '#ffc800' : '#ff2020';
		var srcClr  = current < -1.0 ? '#00e050' : current > 1.0 ? '#ff2020' : '#2060ff';
		m[1]=batClr; m[6]=batClr; m[7]=batClr; m[11]=batClr; m[12]=batClr;
		m[4] = srcClr;
		if (opNum === 3) m[9] = '#00e050';
		else if (opNum === 4) m[9] = '#ffc800';
		m[14] = fresh ? '#00e050' : '#ff2020';
		m[3] = '#00e050';
		return m;
	}
	function computeTempLeds() {
		var m = {};
		var tw = getDW(purposeDene, 'Outdoor Temperature') || getDW(sensorsDene, 'Outdoor Temperature');
		if (!tw) return m;
		var t = parseFloat(tw.value);
		if (isNaN(t) || t === -99) { [1,2,3,7,12].forEach(function(i){ m[i]='#ff2020'; }); return m; }
		var clr = t > 0 ? '#00e050' : t < 0 ? '#2080ff' : '#ffff20';
		var abs_t = Math.abs(t);
		var hd = Math.min(Math.floor(abs_t / 10), 4);
		var ld = Math.floor(abs_t % 10);
		var hdMap = [[],[0],[0,5],[0,5,10],[0,1,5,10]];
		hdMap[hd].forEach(function(i){ m[i]=clr; });
		var ldMap = [[],[4],[4,9],[4,9,14],[4,9,14,3],[4,9,14,3,8],[4,9,14,3,8,13],[4,9,14,3,8,13,2],[4,9,14,3,8,13,2,7],[4,9,14,3,8,13,2,7,12]];
		if (ldMap[ld]) ldMap[ld].forEach(function(i){ m[i]=clr; });
		return m;
	}
	function computeLevelLeds() {
		var m = {};
		var sw = getDW(purposeDene, 'Sceptic Available') || getDW(sensorsDene, 'Sceptic Available');
		if (!sw) return m;
		var pct = parseFloat(sw.value);
		if (isNaN(pct)) return m;
		var clr = pct <= 25 ? '#ff2020' : pct <= 50 ? '#ffdd00' : pct <= 75 ? '#00e050' : '#2080ff';
		[1,2,3,6,7,8,11,12,13].forEach(function(i){ m[i]=clr; });
		return m;
	}
	function computeWifiLeds() {
		var m = {};
		var ws = getDW(purposeDene, 'Wifi Status');
		var status = ws ? parseInt(ws.value) : 0;
		var ant = [1,2,3,5,9,11,12,13];
		if (status === 1) {
			// AP mode — green antenna
			ant.forEach(function(i){ m[i]='#00e050'; });
		} else if (status === 2) {
			// Station, no internet — blue antenna, red centre
			ant.forEach(function(i){ m[i]='#2080ff'; });
			m[7] = '#ff2020';
		} else if (status === 3) {
			// Station + internet — blue antenna, blue centre
			ant.forEach(function(i){ m[i]='#2080ff'; });
			m[7] = '#2080ff';
		}
		// status 0 or unknown — red antenna (WiFi off)
		if (status === 0 || !ws) ant.forEach(function(i){ m[i]='#ff2020'; });
		return m;
	}
	function computeLoraLeds() {
		var m = {};
		var lw = getDW(purposeDene, 'Lora Active');
		var clr = (lw && (String(lw.value).toLowerCase() === 'true' || String(lw.value) === '1')) ? '#00e050' : '#ff2020';
		[1,6,11,12].forEach(function(i){ m[i]=clr; });
		return m;
	}

	// Subheader values
	var secsDW = getDW(purposeDene, "Seconds Time");
	var funcDW = getDW(configDene, "Current Function");
	var funcNum = funcDW ? String(parseInt(funcDW.value)) : "";
	var functionLabel = daffodilFunctionNames[funcNum] || ("Function " + funcNum);
	var timestampStr = "";
	if (secsDW) {
		var ts = new Date(parseInt(secsDW.value) * 1000);
		timestampStr = ts.toLocaleString();
	}

	var tpName = telepathon["Name"];
	var safeId = tpName.replace(/[^a-zA-Z0-9]/g, '_');
	var html = '<div style="display:flex;flex-wrap:wrap;gap:20px;padding:2px 0 10px 0;margin-top:-8px;border-bottom:1px solid #eee;margin-bottom:10px;font-size:13px;">';
	html += '<span><strong>Time:</strong> ' + (timestampStr || (secsDW ? secsDW.value : '—')) + '</span>';
	html += '<span><strong>Function:</strong> ' + functionLabel + '</span>';
	html += '</div>';

	// "Op Mode" = opMode bit0 = USB programming jumper fitted (Daffodil usbJumperFitted()). Left on,
	// the CP2104 USB chip drains the battery in deep sleep and the TPL5010 watchdog is disconnected
	// (TopTank went flat overnight 2026-10-09 that way).
	var usbJumperDW = getDW(purposeDene, "Op Mode");
	if (usbJumperDW && (String(usbJumperDW.value).toLowerCase() === 'true' || String(usbJumperDW.value) === '1')) {
		html += '<div style="background:#c62828;color:#fff;font-weight:bold;padding:6px 10px;border-radius:4px;margin-bottom:10px;font-size:13px;">'
			+ '&#9888; USB programming jumper is fitted - the USB chip is draining the battery and the watchdog is disconnected. Move the jumper back to the watchdog header.</div>';
	}

	html += '<ul class="nav nav-pills" style="margin-bottom:10px;">';
	html += '<li class="active" onclick="return teleonomeShowTab(\'daff-results-' + safeId + '\', this)"><a href="#">Status</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'daff-config-' + safeId + '\', this)"><a href="#">Config</a></li>';
	html += '</ul><div class="tab-content">';

	// Status tab — LED snapshot + sub-pills for data sections
	var ledSnapshot = '<div style="background:#0c0c1a;border-radius:10px;padding:10px 4px 8px;margin-bottom:14px;display:flex;flex-wrap:wrap;justify-content:space-around;gap:4px;">';
	var socSnap = DeviceViewsHost.setting(tpName, DENEWORD_PULSE_TASK_BATTERY_SOC_LIVE);
	var socLabel = socSnap !== null ? 'SOC: ' + parseFloat(socSnap).toFixed(1) + '%' : null;
	ledSnapshot += snapPanel('Battery', ledSvg(computeBatLeds()), socLabel);
	ledSnapshot += snapPanel('Temperature', ledSvg(computeTempLeds()));
	ledSnapshot += snapPanel('Level',       ledSvg(computeLevelLeds()));
	ledSnapshot += snapPanel('WiFi',        ledSvg(computeWifiLeds()));
	ledSnapshot += snapPanel('LoRa',        ledSvg(computeLoraLeds()));
	ledSnapshot += '</div>';

	html += '<div class="tab-pane active" id="daff-results-' + safeId + '">';
	html += ledSnapshot;

	// Sub-pills (smaller than top-level pills)
	var subPillStyle = 'font-size:12px;padding:3px 9px;';
	html += '<ul class="nav nav-pills" style="margin-bottom:8px;flex-wrap:wrap;">';
	html += '<li class="active" onclick="return teleonomeShowTab(\'daff-sensors-' + safeId + '\', this)"><a href="#" style="' + subPillStyle + '">Sensors</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'daff-power-' + safeId + '\', this)"><a href="#" style="' + subPillStyle + '">Power</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'daff-comms-' + safeId + '\', this)"><a href="#" style="' + subPillStyle + '">Comms</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'daff-diag-' + safeId + '\', this)"><a href="#" style="' + subPillStyle + '">Diagnostics</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'daff-help-' + safeId + '\', this)"><a href="#" style="' + subPillStyle + '">Help</a></li>';
	html += '</ul>';
	html += '<div class="tab-content">';

	var noGraphFields = {"Op Mode":1,"Weather Fresh":1,"INA219 Found":1,"BH1750 Found":1,"ADS1115 Found":1,"RTC Found":1,"DS18B20 Found":1,"SHT Found":1,"Invalid Time":1,"Using Solar Power":1,"Local Time":1,"Source Original Time":1,"Operating Status":1};
	var cardGroups = [
		{ id: 'daff-sensors-' + safeId, title: "Sensors", fields: ["Measured Height", "Measured Height 2", "Water Temperature", "Sceptic Available", "Light Level", "Outdoor Temperature", "Outdoor Humidity", "Internal Temperature", "Tank 1 Pressure Psi", "Tank 1 Water Level", "Tank 2 Pressure Psi", "Tank 2 Water Level"] },
		{ id: 'daff-power-' + safeId,   title: "Power",   fields: ["Panel Voltage", "Panel Current", "Battery Voltage", "Battery Current", "V50 Voltage", "Led Brightness", "Operating Status", "Async Data", "Wake Time Sec", "Sleep Time", "Estimated Runtime"] },
		{ id: 'daff-comms-' + safeId,   title: "Comms",   fields: ["rssi", "snr", "Digital Stables Upload", "Lora Active", "ds Last Upload"] },
		{ id: 'daff-diag-' + safeId,    title: "Diagnostics", fields: ["RTC Battery Volt", "Op Mode", "Weather Fresh", "INA219 Found", "BH1750 Found", "ADS1115 Found", "RTC Found", "DS18B20 Found", "SHT Found", "Invalid Time", "Using Solar Power", "Source Original Time", "Local Time"] }
	];
	for (var ci = 0; ci < cardGroups.length; ci++) {
		var card = cardGroups[ci];
		html += '<div class="tab-pane' + (ci === 0 ? ' active' : '') + '" id="' + card.id + '">';
		// The Diagnostics card's table becomes its "Hardware" sub-tab (see buildDiagnosticsSubTabs).
		var cardOuterHtml = null;
		if (card.title === "Diagnostics") { cardOuterHtml = html; html = ''; }
		if (card.title === "Power") {
			html += multiChartPanelGroup([
				{ title: "Power Chart",         dwNames: ["Panel Voltage", "Battery Voltage", "Battery Current", "Panel Current"], dwUnits: ["V", "V", "mA", "mA"] },
				{ title: "Solar Power Chart",   dwNames: ["Panel Voltage", "Panel Current"], dwUnits: ["V", "mA"] },
				{ title: "Battery Power Chart", dwNames: ["Battery Voltage", "Battery Current"], dwUnits: ["V", "mA"] }
			]);
			html += multiChartPanel("Solar / Light Chart", ["Panel Current", "Light Level"], ["mA", "Lux"]);
		}
		html += '<table class="table table-condensed table-striped" style="margin-bottom:0;font-size:12px;">';
		for (var fi = 0; fi < card.fields.length; fi++) {
			var fieldName = card.fields[fi];
			var r = getVal(purposeDene, fieldName, sensorsDene);
			if (!r) continue;
			var displayVal = r.value;
			var displayUnits = r.units;
			if (fieldName === "Operating Status") {
				displayVal = daffodilOperatingStatusNames[String(parseInt(r.value))] || r.value;
			}
			if (fieldName === "Source Original Time") {
				// The device's own clock reading (epoch seconds) as sent, before the deserializer's
				// correction - shown as a timestamp, same formatting as the vital signs' reset times.
				var srcEpoch = parseInt(r.value);
				if (srcEpoch > 0) displayVal = new Date(srcEpoch * 1000).toLocaleString() + ' <span style="color:#999;font-weight:normal;">(' + srcEpoch + ')</span>';
			}
			if (fieldName === "Light Level" && displayUnits && displayUnits.toLowerCase() === 'meter') {
				displayUnits = 'Lux';
			}
			var fieldLabel = fieldName;
			if (fieldName === "Op Mode") {
				// opMode bit0 = USB programming jumper (see the banner above the tabs)
				fieldLabel = "USB Jumper";
				var jumperOn = String(r.value).toLowerCase() === 'true' || String(r.value) === '1';
				displayVal = jumperOn ? '<span style="color:#c62828;">FITTED</span>' : 'off';
			}
			var valCell = '<strong>' + displayVal + (displayUnits ? ' ' + displayUnits : '') + '</strong>';
			var btnCell = noGraphFields[fieldName] ? '' : '<td style="text-align:right;white-space:nowrap;padding:2px 4px;">' + mkGraphBtns(tpName, r.deneName, fieldName) + '</td>';
			html += '<tr><td style="width:40%;">' + fieldLabel + '</td><td>' + valCell + '</td>' + btnCell + '</tr>';
			if (card.title === "Power" && fieldName === "Battery Current") {
				var socVal = DeviceViewsHost.setting(tpName, DENEWORD_PULSE_TASK_BATTERY_SOC_LIVE);
				if (socVal !== null) {
					html += '<tr><td style="width:40%;">Battery SOC</td><td><strong>' + parseFloat(socVal).toFixed(1) + '%</strong></td>'
						+ '<td style="text-align:right;white-space:nowrap;padding:2px 4px;">' + mkGraphBtns(tpName, "Purpose", DENEWORD_PULSE_TASK_BATTERY_SOC_LIVE) + '</td></tr>';
				}
				// LedgerSoc next to it (2026-10-14), while the two are compared - only once the device sends a v3 ledger
				var ledgerSoc = DeviceViewsHost.setting(tpName, DENEWORD_LEDGER_SOC);
				if (ledgerSoc !== null) {
					var ledgerMah = DeviceViewsHost.setting(tpName, DENEWORD_LEDGER_CHARGE_MAH);
					var ledgerAnchor = parseInt(DeviceViewsHost.setting(tpName, DENEWORD_LEDGER_LAST_ANCHOR));
					html += '<tr><td style="width:40%;">Battery SOC (ledger)</td><td><strong>' + parseFloat(ledgerSoc).toFixed(1) + '%</strong>'
						+ (ledgerMah !== null ? ' <span style="color:#999;">' + Math.round(parseFloat(ledgerMah)) + ' mAh</span>' : '') + '</td>'
						+ '<td style="text-align:right;white-space:nowrap;padding:2px 4px;">' + mkGraphBtns(tpName, "Purpose", DENEWORD_LEDGER_SOC) + '</td></tr>';
					if (ledgerAnchor > 0) {
						html += '<tr><td style="width:40%;">Ledger last anchor</td><td><strong>' + new Date(ledgerAnchor * 1000).toLocaleString()
							+ '</strong> <span style="color:#999;">(' + deviceViewsFormatAge(Date.now() / 1000 - ledgerAnchor) + ')</span></td><td></td></tr>';
					}
				}
			}
		}
		html += '</table>';
		if (card.title === "Diagnostics") {
			html = cardOuterHtml + buildDiagnosticsSubTabs(card.id,
				// null: no Sensors group - the Hardware sub-tab's "... Found" rows cover it
				buildVitalSignsPanel(telepathon, tpName, null, "Daffodil"),
				html,
				buildDeviceIdentityPanel(telepathon, "Daffodil"));
		}
		html += '</div>';
	}

	// Help sub-tab — LED panel descriptions
	html += '<div class="tab-pane" id="daff-help-' + safeId + '">';
	html += '<div style="font-size:12px;line-height:1.6;">';

	function helpSection(title, color, rows) {
		var s = '<div style="margin-bottom:14px;">';
		s += '<div style="font-weight:bold;font-size:13px;color:' + color + ';border-bottom:1px solid #eee;padding-bottom:3px;margin-bottom:6px;">' + title + '</div>';
		s += '<table style="width:100%;border-collapse:collapse;">';
		for (var hi = 0; hi < rows.length; hi++) {
			s += '<tr><td style="width:36%;padding:2px 6px 2px 0;color:#555;vertical-align:top;">' + rows[hi][0] + '</td>'
				+ '<td style="padding:2px 0;vertical-align:top;">' + rows[hi][1] + '</td></tr>';
		}
		s += '</table></div>';
		return s;
	}

	html += helpSection('Battery', '#2060ff', [
		['Voltage color', '<span style="color:#2060ff;font-weight:bold;">Blue</span> ≥3.28 V (excellent) &nbsp; <span style="color:#00b040;font-weight:bold;">Green</span> ≥3.18 V (good) &nbsp; <span style="color:#cc8800;font-weight:bold;">Yellow</span> ≥3.10 V (low) &nbsp; <span style="color:#cc2020;font-weight:bold;">Red</span> &lt;3.10 V (critical)'],
		['Source (LED 5)',  '<span style="color:#00b040;font-weight:bold;">Green</span> = charging/solar &nbsp; <span style="color:#cc2020;font-weight:bold;">Red</span> = discharging &nbsp; <span style="color:#2060ff;font-weight:bold;">Blue</span> = stable/idle'],
		['Op mode (LED 10)', '<span style="color:#00b040;font-weight:bold;">Green</span> = Full operation &nbsp; <span style="color:#cc8800;font-weight:bold;">Yellow</span> = Cloudy (reduced)'],
		['Weather Forecast (LED 15)', '<span style="color:#00b040;font-weight:bold;">Green</span> = weather data fresh &nbsp; <span style="color:#cc2020;font-weight:bold;">Red</span> = weather data stale'],
		['Comma Records (LED 4)', '<span style="color:#00b040;font-weight:bold;">Green</span> = no comma records pending &nbsp; <span style="color:#2060ff;font-weight:bold;">Blue</span> = transmitting &nbsp; <span style="color:#cc8800;font-weight:bold;">Yellow</span> = comma records queued']
	]);

	html += helpSection('Temperature', '#00b040', [
		['Sign color', '<span style="color:#00b040;font-weight:bold;">Green</span> = above 0 °C &nbsp; <span style="color:#2060ff;font-weight:bold;">Blue</span> = below 0 °C &nbsp; <span style="color:#cccc00;font-weight:bold;">Yellow</span> = exactly 0 °C'],
		['Tens digit', 'Left-column LEDs (0,5,10,1,6) — number of lit LEDs encodes the tens value (0–4)'],
		['Units digit', 'Right-column LEDs (4,9,14,3,8,13,2,7,12) — LEDs light progressively for 1–9'],
		['Error', '<span style="color:#cc2020;font-weight:bold;">Red</span> on a fixed pattern = sensor read failure or invalid value']
	]);

	html += helpSection('Level (Sceptic)', '#27ae60', [
		['Reading', 'Nine LEDs in a 3×3 grid, all the same color, showing tank capacity %'],
		['Colors', '<span style="color:#2060ff;font-weight:bold;">Blue</span> &gt;75% (full) &nbsp; <span style="color:#00b040;font-weight:bold;">Green</span> 26–75% (normal) &nbsp; <span style="color:#cc8800;font-weight:bold;">Yellow</span> 11–25% (low) &nbsp; <span style="color:#cc2020;font-weight:bold;">Red</span> ≤10% (critical)'],
		['No LEDs', 'Sensor not fitted or no reading available']
	]);

	html += helpSection('WiFi', '#2080ff', [
		['All red', 'WiFi is disabled or turned off'],
		['All green', 'AP mode — the Daffodil is broadcasting its own hotspot'],
		['Blue + red center', 'Connected to WiFi network but no internet access'],
		['Blue + blue center', 'Connected to WiFi with full internet access']
	]);

	html += helpSection('LoRa', '#9b59b6', [
		['Green', 'LoRa radio is active and transmitting data to the gateway'],
		['Red', 'LoRa radio is inactive or not connected']
	]);

	html += '</div></div>'; // help content + tab-pane

	html += '</div>'; // inner tab-content
	html += '</div>'; // daff-results tab-pane

	// Config tab
	html += '<div class="tab-pane" id="daff-config-' + safeId + '">';
	html += '<table class="table table-condensed table-striped" style="font-size:13px;">';
	var configFields = configDene ? (configDene["DeneWords"] || []) : [];
	for (var cfi = 0; cfi < configFields.length; cfi++) {
		var cfName = configFields[cfi]["Name"];
		var cfVal = configFields[cfi]["Value"];
		if (cfName === "Current Function") cfVal = functionLabel;
		html += '<tr><td style="width:50%;">' + cfName + '</td><td><strong>' + cfVal + '</strong></td></tr>';
	}
	var sensFields = sensorsDene ? (sensorsDene["DeneWords"] || []) : [];
	for (var sfi = 0; sfi < sensFields.length; sfi++) {
		html += '<tr><td style="width:50%;">' + sensFields[sfi]["Name"] + '</td><td><strong>' + sensFields[sfi]["Value"] + (sensFields[sfi]["Units"] ? ' ' + sensFields[sfi]["Units"] : '') + '</strong></td></tr>';
	}
	html += '</table></div>';

	html += '</div>'; // outer tab-content
	return html;
}

// Field names below come from LangleyDataDeserializer.java (com.teleonome.framework
// .microcontroller.annabellemicrocontroller) — the "Purpose" DeneWords it emits for a
// Langley electric-fence monitor. Operating Status shares the same 1-5 taxonomy as
// Daffodil (see LangleyData.h), so daffodilOperatingStatusNames is reused for its label.
function buildLangleyContent(telepathon) {
	var denes = telepathon["Denes"] || [];
	var purposeDene = null, configDene = null;
	for (var i = 0; i < denes.length; i++) {
		if (denes[i]["Name"] === "Purpose") purposeDene = denes[i];
		else if (denes[i]["Name"] === "Configuration") configDene = denes[i];
	}
	var pw = purposeDene ? (purposeDene["DeneWords"] || []) : [];
	var cw = configDene ? (configDene["DeneWords"] || []) : [];

	function findDW(words, name) {
		for (var fi = 0; fi < words.length; fi++) if (words[fi]["Name"] === name) return words[fi];
		return null;
	}
	function mkGraphBtns(tpName, deneName, dwName) {
		var d = 'data-telepathonname="' + tpName + '" data-denename="' + deneName + '" data-denewordname="' + dwName + '"';
		var btnCls = 'btn btn-xs btn-default telepathon-history-value';
		return '<button class="' + btnCls + '" ' + d + ' data-range="3600000">1h</button> ' +
			'<button class="' + btnCls + '" ' + d + ' data-range="86400000">24h</button> ' +
			'<button class="' + btnCls + ' hidden-xs" ' + d + ' data-range="604800000">7d</button>';
	}
	function mkMultiGraphBtns(tpName, deneName, dwNames, dwUnits, chartTitle) {
		var d = 'data-telepathonname="' + tpName + '" data-denename="' + deneName + '"' +
			' data-denewordnames="' + dwNames.join(',') + '" data-denewordunits="' + dwUnits.join(',') + '"' +
			' data-title="' + chartTitle + '"';
		var btnCls = 'btn btn-xs btn-primary telepathon-multi-history-value';
		return '<button class="' + btnCls + '" ' + d + ' data-range="3600000">1h</button> ' +
			'<button class="' + btnCls + '" ' + d + ' data-range="86400000">24h</button> ' +
			'<button class="' + btnCls + ' hidden-xs" ' + d + ' data-range="604800000">7d</button>';
	}
	function multiChartPanel(chartTitle, dwNames, dwUnits) {
		return '<div style="margin-bottom:8px;padding:6px 8px;background:#eef3fa;border-radius:6px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;">' +
			'<span style="font-size:12px;font-weight:bold;color:#2c3e50;margin-right:4px;">' + chartTitle + '</span>' +
			mkMultiGraphBtns(tpName, 'Purpose', dwNames, dwUnits, chartTitle) +
			'</div>';
	}
	// Same blue panel as multiChartPanel, but holds several titled button-groups side by side
	// (each with its own 1h/24h/7d combined-chart buttons) instead of a separate blue line per chart.
	function multiChartPanelGroup(items) {
		var groups = items.map(function(it) {
			return '<span style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-right:22px;">' +
				'<span style="font-size:12px;font-weight:bold;color:#2c3e50;margin-right:4px;">' + it.title + '</span>' +
				mkMultiGraphBtns(tpName, 'Purpose', it.dwNames, it.dwUnits, it.title) +
				'</span>';
		}).join('');
		return '<div style="margin-bottom:8px;padding:6px 8px;background:#eef3fa;border-radius:6px;display:flex;align-items:center;flex-wrap:wrap;">' +
			groups +
			'</div>';
	}
	function vitalCard(label, val, unit, color) {
		return '<div class="col-xs-4 col-sm-2" style="margin-bottom:8px;padding:2px;">' +
			'<div style="border-radius:10px;overflow:hidden;">' +
			'<div style="padding:8px 4px;color:white;text-align:center;background:' + color + ';">' +
			'<div style="font-size:9px;text-transform:uppercase;font-weight:bold;opacity:0.9;">' + label + '</div>' +
			'<div style="font-size:16px;font-weight:800;">' + val + unit + '</div>' +
			'</div></div></div>';
	}
	function row(label, dw, tpName, deneName) {
		if (!dw) return '';
		return '<tr><td style="width:40%;">' + label + '</td><td><strong>' + dw["Value"] + (dw["Units"] ? ' ' + dw["Units"] : '') + '</strong></td>' +
			'<td style="text-align:right;white-space:nowrap;padding:2px 4px;">' + mkGraphBtns(tpName, deneName, dw["Name"]) + '</td></tr>';
	}

	var tpName = telepathon["Name"];
	var safeId = tpName.replace(/[^a-zA-Z0-9]/g, '_');

	var localTimeDW = findDW(pw, "Local Time");
	var fenceAvgDW = findDW(pw, "Fence Voltage Avg");
	var opStatusDW = findDW(pw, "Operating Status");
	var opNum = opStatusDW ? String(parseInt(opStatusDW["Value"])) : null;
	var opLabel = opNum !== null ? (daffodilOperatingStatusNames[opNum] || ('Mode ' + opNum)) : '—';
	var battDW = findDW(pw, "Battery Voltage");
	var solarDW = findDW(pw, "Solar Voltage");
	var energizerDW = findDW(pw, "Energizer Battery Voltage");
	var tempDW = findDW(pw, "Internal Temperature");
	var rssiDW = findDW(pw, "rssi");

	// Thresholds are a reasonable default for a working energizer (a healthy fence
	// typically pulses well above 3kV; under ~1kV it's generally not delivering an
	// effective shock) — adjust here if the real-world numbers say otherwise.
	var fenceKV = fenceAvgDW ? parseFloat(fenceAvgDW["Value"]) : null;
	var fenceColor = fenceKV === null ? '#999' : (fenceKV >= 3 ? '#27ae60' : (fenceKV >= 1 ? '#f39c12' : '#e74c3c'));

	var html = '<div style="background:white;">';
	html += '<div style="padding:2px 0 10px 0;margin-top:-8px;border-bottom:1px solid #eee;margin-bottom:10px;font-size:13px;color:#888;">';
	html += (localTimeDW ? localTimeDW["Value"] : '') + '&nbsp;&nbsp;' + opLabel;
	html += '</div>';

	html += '<ul class="nav nav-pills" style="margin-bottom:10px;">';
	html += '<li class="active" onclick="return teleonomeShowTab(\'lang-status-' + safeId + '\', this)"><a href="#">Status</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'lang-config-' + safeId + '\', this)"><a href="#">Config</a></li>';
	html += '</ul><div class="tab-content">';

	// Status: the summary tiles, then sub-tabs that keep what the device senses (the energizer and the fence)
	// apart from how it powers itself, as on Daffodil (2026-11-01, Ari).
	html += '<div class="tab-pane active" id="lang-status-' + safeId + '">';
	html += '<div class="row" style="margin-bottom:8px;">';
	html += vitalCard('Fence Voltage', fenceKV !== null ? fenceKV.toFixed(1) : '—', 'kV', fenceColor);
	if (energizerDW) html += vitalCard('Energizer Batt', energizerDW["Value"], 'V', '#3498db');
	if (battDW) html += vitalCard('Battery', battDW["Value"], 'V', '#3498db');
	if (solarDW) html += vitalCard('Solar', solarDW["Value"], 'V', '#3498db');
	if (tempDW) html += vitalCard('Temp', tempDW["Value"], '°C', '#3498db');
	if (rssiDW) { var rssiV = parseFloat(rssiDW["Value"]); html += vitalCard('Signal', rssiDW["Value"], '', rssiV > -95 ? '#27ae60' : '#f39c12'); }
	html += '</div>';

	var subPillStyle = 'font-size:12px;padding:3px 9px;';
	html += '<ul class="nav nav-pills" style="margin-bottom:8px;flex-wrap:wrap;">';
	html += '<li class="active" onclick="return teleonomeShowTab(\'lang-energizer-' + safeId + '\', this)"><a href="#" style="' + subPillStyle + '">Energizer</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'lang-power-' + safeId + '\', this)"><a href="#" style="' + subPillStyle + '">Power</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'lang-comms-' + safeId + '\', this)"><a href="#" style="' + subPillStyle + '">Comms</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'lang-diag-' + safeId + '\', this)"><a href="#" style="' + subPillStyle + '">Diagnostics</a></li>';
	html += '</ul>';
	html += '<div class="tab-content">';

	function table(rows) {
		return '<table class="table table-condensed table-striped" style="margin-bottom:0;font-size:12px;">' + rows + '</table>';
	}
	function plainRow(label, dw) {
		if (!dw) return '';
		return '<tr><td style="width:40%;">' + label + '</td><td><strong>' + dw["Value"] + (dw["Units"] ? ' ' + dw["Units"] : '') + '</strong></td><td></td></tr>';
	}

	// Energizer: the sensor - the fence it watches and the energizer's own battery
	html += '<div class="tab-pane active" id="lang-energizer-' + safeId + '">';
	html += multiChartPanelGroup([
		{ title: "Fence Chart",     dwNames: ["Fence Voltage Avg", "Fence Voltage Min", "Fence Voltage Max"], dwUnits: ["kV", "kV", "kV"] },
		{ title: "Energizer Chart", dwNames: ["Energizer Battery Voltage", "Energizer Battery Current"], dwUnits: ["V", "mA"] }
	]);
	html += table(
		row('Fence Voltage Avg', fenceAvgDW, tpName, 'Purpose') +
		row('Fence Voltage Min', findDW(pw, 'Fence Voltage Min'), tpName, 'Purpose') +
		row('Fence Voltage Max', findDW(pw, 'Fence Voltage Max'), tpName, 'Purpose') +
		row('Fence Voltage', findDW(pw, 'Fence Voltage'), tpName, 'Purpose') +
		row('Pulse Count', findDW(pw, 'Pulse Count'), tpName, 'Purpose') +
		row('Seconds Since Last Pulse', findDW(pw, 'Seconds Since Last Pulse'), tpName, 'Purpose') +
		row('Energizer Battery Voltage', energizerDW, tpName, 'Purpose') +
		row('Energizer Battery Current', findDW(pw, 'Energizer Battery Current'), tpName, 'Purpose'));
	html += '</div>';

	// Power: how the Langley itself is powered (solar panel, its battery)
	html += '<div class="tab-pane" id="lang-power-' + safeId + '">';
	html += multiChartPanelGroup([
		{ title: "Power Chart",         dwNames: ["Solar Voltage", "Battery Voltage", "Battery Current", "Solar Current"], dwUnits: ["V", "V", "mA", "mA"] },
		{ title: "Solar Power Chart",   dwNames: ["Solar Voltage", "Solar Current"], dwUnits: ["V", "mA"] },
		{ title: "Battery Power Chart", dwNames: ["Battery Voltage", "Battery Current"], dwUnits: ["V", "mA"] }
	]);
	var powerRows = row('Solar Voltage', solarDW, tpName, 'Purpose') +
		row('Solar Current', findDW(pw, 'Solar Current'), tpName, 'Purpose') +
		row('Battery Voltage', battDW, tpName, 'Purpose') +
		row('Battery Current', findDW(pw, 'Battery Current'), tpName, 'Purpose');
	var socVal = DeviceViewsHost.setting(tpName, DENEWORD_PULSE_TASK_BATTERY_SOC_LIVE);
	if (socVal !== null && socVal !== undefined) {
		powerRows += '<tr><td style="width:40%;">Battery SOC</td><td><strong>' + parseFloat(socVal).toFixed(1) + '%</strong></td>'
			+ '<td style="text-align:right;white-space:nowrap;padding:2px 4px;">' + mkGraphBtns(tpName, "Purpose", DENEWORD_PULSE_TASK_BATTERY_SOC_LIVE) + '</td></tr>';
	}
	powerRows += row('External Battery Voltage', findDW(pw, 'External Battery Voltage'), tpName, 'Purpose') +
		row('Overnight Use', findDW(pw, 'Overnight Mah'), tpName, 'Purpose') +
		row('Estimated Runtime', findDW(pw, 'Estimated Runtime'), tpName, 'Purpose');
	if (opStatusDW) powerRows += '<tr><td style="width:40%;">Operating Status</td><td><strong>' + opLabel + '</strong></td><td></td></tr>';
	html += table(powerRows);
	html += '</div>';

	// Comms: the LoRa link to the Teleonome
	html += '<div class="tab-pane" id="lang-comms-' + safeId + '">';
	html += table(
		row('rssi', rssiDW, tpName, 'Purpose') +
		row('snr', findDW(pw, 'snr'), tpName, 'Purpose') +
		plainRow('Parent Short Name', findDW(pw, 'Parent Short Name')) +
		plainRow('Branch Label', findDW(pw, 'Branch Label')));
	html += '</div>';

	// Diagnostics: vital signs, the board, the firmware
	var hardwareHtml = table(
		row('Internal Temperature', tempDW, tpName, 'Purpose') +
		row('RTC Battery Voltage', findDW(pw, 'RTC Battery Voltage'), tpName, 'Purpose') +
		plainRow('Local Time', localTimeDW) +
		plainRow('Checksum', findDW(pw, 'Checksum')));
	html += '<div class="tab-pane" id="lang-diag-' + safeId + '">';
	html += buildDiagnosticsSubTabs('lang-diag-' + safeId,
		buildVitalSignsPanel(telepathon, tpName, ["INA219 Solar", "INA219 Battery", "INA219 Energizer", "ADS1115 Fence", "DS18B20 Board"], "Langley"),
		hardwareHtml,
		buildDeviceIdentityPanel(telepathon, "Langley"));
	html += '</div>';

	html += '</div>'; // sub tab-content
	html += '</div>'; // status pane

	html += '<div class="tab-pane" id="lang-config-' + safeId + '">';
	html += '<table class="table table-condensed table-striped" style="font-size:13px;">';
	for (var ci = 0; ci < cw.length; ci++) {
		html += '<tr><td style="width:50%;">' + cw[ci]["Name"] + '</td><td><strong>' + cw[ci]["Value"] + (cw[ci]["Units"] ? ' ' + cw[ci]["Units"] : '') + '</strong></td></tr>';
	}
	html += '</table></div>';

	html += '</div>'; // tab-content
	html += '</div>';
	return html;
}

function buildTelepathonDetailContent(telepathon) {
	var denes = telepathon["Denes"] || [];
	if (denes.length === 0) return '<p class="text-muted text-center" style="padding:20px;">No data available.</p>';
	var safeId = telepathon["Name"].replace(/[^a-zA-Z0-9]/g, '_');
	var html = '<ul class="nav nav-pills" style="margin-bottom:12px;flex-wrap:wrap;">';
	for (var pi = 0; pi < denes.length; pi++) {
		var paneId = 'tpDetail-' + safeId + '-' + pi;
		html += '<li' + (pi === 0 ? ' class="active"' : '') +
			' onclick="return teleonomeShowTab(\'' + paneId + '\', this)" style="margin-bottom:4px;">' +
			'<a href="#">' + denes[pi]["Name"] + '</a></li>';
	}
	html += '</ul><div class="tab-content">';
	for (var ti = 0; ti < denes.length; ti++) {
		var paneId2 = 'tpDetail-' + safeId + '-' + ti;
		html += '<div class="tab-pane' + (ti === 0 ? ' active' : '') + '" id="' + paneId2 + '">';
		html += '<table class="table table-condensed table-striped">';
		var dws = denes[ti]["DeneWords"] || [];
		for (var j = 0; j < dws.length; j++) {
			html += '<tr><td>' + dws[j]["Name"] + '</td><td><strong>' + dws[j]["Value"] + '</strong>' +
				(dws[j]["Units"] ? ' ' + dws[j]["Units"] : '') + '</td></tr>';
		}
		html += '</table></div>';
	}
	html += '</div>';
	return html;
}

function buildChinampaContent(telepathon, safeId) {
	var tpName = telepathon["Name"];
	safeId = safeId || tpName.replace(/[^a-zA-Z0-9]/g, '_');
	var purposeDene = null, configDene = null, sensorsDene = null;
	var denes = telepathon["Denes"];
	for (var i = 0; i < denes.length; i++) {
		if (denes[i]["Name"] === "Purpose") purposeDene = denes[i];
		else if (denes[i]["Name"] === "Configuration") configDene = denes[i];
		else if (denes[i]["Name"] === "Sensors") sensorsDene = denes[i];
	}
	var pw = purposeDene ? purposeDene["DeneWords"] : [];
	var sw = sensorsDene ? sensorsDene["DeneWords"] : [];

	function findDW(words, name) {
		for (var i = 0; i < words.length; i++) if (words[i]["Name"] === name) return words[i];
		return null;
	}
	function fmtVal(dw) {
		if (!dw) return "—";
		var v = String(dw["Value"]);
		if (v.toLowerCase() === "true") return '<span style="color:#27ae60;font-weight:bold;">● ACTIVE</span>';
		if (v.toLowerCase() === "false") return '<span style="color:#999;">○ OFF</span>';
		return v + (dw["Units"] ? " " + dw["Units"] : "");
	}
	function svgGauge(totalH, measuredH, flash) {
		totalH = parseFloat(totalH) || 1;
		measuredH = parseFloat(measuredH) || 0;
		var fh = Math.max(5, Math.round(((totalH - measuredH) / totalH) * 100));
		var fy = 5 + (100 - fh);
		var fc = flash ? '#e74c3c' : '#3498db';
		return '<svg width="80" height="120"><rect x="10" y="5" width="60" height="100" fill="#eaedef" rx="4" stroke="#ccc"/>' +
			'<rect x="10" y="' + fy + '" width="60" height="' + fh + '" fill="' + fc + '" rx="2"/>' +
			'<text x="40" y="115" text-anchor="middle" font-size="11" font-weight="bold">' + Math.round(totalH - measuredH) + 'cm</text></svg>';
	}
	function metricBox(dw, btns) {
		if (!dw) return '';
		var s = '<div style="border-left:3px solid #3498db;background:#f0f4f8;margin-bottom:4px;border-radius:2px;overflow:hidden;">';
		s += '<div style="padding:4px 6px;">';
		s += '<div style="font-size:9px;color:#777;font-weight:bold;text-transform:uppercase;">' + dw["Name"] + '</div>';
		s += '<div style="font-size:12px;color:#333;">' + fmtVal(dw) + '</div>';
		s += '</div>';
		if (btns) s += '<div style="background:#e8edf2;text-align:right;padding:2px 4px;">' + btns + '</div>';
		s += '</div>';
		return s;
	}
	function mkGraphBtns(tpName, deneName, dwName, nucleus) {
		var nucleusAttr = nucleus ? ' data-nucleus="' + nucleus + '"' : '';
		var d = 'data-telepathonname="' + tpName + '" data-denename="' + deneName + '" data-denewordname="' + dwName + '"' + nucleusAttr;
		var btnCls = 'btn btn-xs btn-default telepathon-history-value';
		return '<button class="' + btnCls + '" ' + d + ' data-range="3600000">1h</button> ' +
			'<button class="' + btnCls + '" ' + d + ' data-range="86400000">24h</button> ' +
			'<button class="' + btnCls + ' hidden-xs" ' + d + ' data-range="604800000">7d</button>';
	}
	function vitalCard(label, val, unit, color, btns) {
		var html = '<div class="col-xs-4 col-sm-2" style="margin-bottom:8px;padding:2px;">';
		html += '<div style="border-radius:10px;overflow:hidden;">';
		html += '<div style="padding:8px 4px;color:white;text-align:center;background:' + color + ';">';
		html += '<div style="font-size:9px;text-transform:uppercase;font-weight:bold;opacity:0.9;">' + label + '</div>';
		html += '<div style="font-size:16px;font-weight:800;">' + val + unit + '</div>';
		html += '</div>';
		if (btns) html += '<div style="background:#f0f0f0;text-align:center;padding:3px 2px;">' + btns + '</div>';
		html += '</div></div>';
		return html;
	}

	var localTime = findDW(pw, "Local Time");
	var alertStatusDW = findDW(pw, "Alert Status");
	var alertCodeDW = findDW(pw, "Alert Code");
	var alertStatus = alertStatusDW && String(alertStatusDW["Value"]).toLowerCase() === "true";
	var alertCode = alertCodeDW ? parseInt(alertCodeDW["Value"]) : 0;
	var alertMessages = {0:"Initializing...",1:"Fish Tank Data Stale",2:"Sump Trough Stale",3:"FT & Sump Data Stale",4:"Solenoid Open / Low Flow",5:"Sump Level Too Low",6:"System Low In Water"};

	var ftH = findDW(sw, "Fish Tank Height");
	var ftM = findDW(pw, "Fish Tank Measured Height");
	var stH = findDW(sw, "Sump Trough Height");
	var stM = findDW(pw, "Sump Trough Measured Height");
	var maxPCBdw = findDW(sw, "u Temperature Maximum");
	var maxPCB = maxPCBdw ? parseFloat(maxPCBdw["Value"]) : 75;
	var pcbDW = findDW(pw, "PCB Temperature");
	var rssiDW = findDW(pw, "rssi");
	var snrDW = findDW(pw, "snr");
	var outdoorTempDW = findDW(pw, "Outdoor Temperature");
	var outdoorHumDW = findDW(pw, "Outdoor Humidity");

	var usedKeys = ["Fish Tank Outflow Flow Rate","Fish Tank Outflow Solenoid Relay Status","Pump Flow Rate","Pump Relay Status",
		"Fish Tank Measured Height","Sump Trough Measured Height","Local Time","TOTP","Alert Status","Alert Code",
		"Outdoor Temperature","Outdoor Humidity","PCB Temperature","rssi","snr",
		"Seconds Since Last Fish Tank Data","Seconds Since Last Sump Trough Data"];

	function denewordGrid(words, accentColor) {
		var g = '<div class="row" style="margin:0;">';
		for (var gi = 0; gi < words.length; gi++) {
			g += '<div class="col-xs-6 col-sm-4" style="margin-bottom:6px;padding:2px 4px;">';
			g += '<div style="border:1px solid #eee;border-radius:4px;padding:5px;border-left:3px solid ' + accentColor + ';">';
			g += '<div style="font-size:9px;color:#777;">' + words[gi]["Name"] + '</div>';
			g += '<div style="font-weight:bold;font-size:12px;">' + fmtVal(words[gi]) + '</div>';
			g += '</div></div>';
		}
		g += '</div>';
		return g;
	}

	var html = '<div style="background:white;">';

	if (alertStatus) {
		html += '<div style="background:#e74c3c;color:white;padding:6px 12px;text-align:center;font-weight:bold;font-size:13px;">' + (alertMessages[alertCode] || "Alert") + '</div>';
	}

	// Pill tabs
	html += '<ul class="nav nav-pills" style="padding:8px 12px 0;margin:0;">';
	html += '<li class="active" onclick="return teleonomeShowTab(\'chinampa-purpose\', this)"><a href="#">Purpose</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'chinampa-sensors\', this)"><a href="#">Sensors</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'chinampa-config\', this)"><a href="#">Configuration</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'chinampa-diag\', this)"><a href="#">Diagnostics</a></li>';
	html += '</ul>';

	var modalAgeSec = Math.floor((Date.now() - DeviceViewsHost.pulseTimeMs()) / 1000);
	var modalStatusColor = modalAgeSec < 60 ? '#27ae60' : (modalAgeSec < 120 ? '#f39c12' : '#e74c3c');
	html += '<div style="padding:4px 12px 6px;font-size:11px;color:#888;border-bottom:1px solid #eee;">';
	html += (localTime ? localTime["Value"] : '') +
		'&nbsp;&nbsp;<span style="color:' + modalStatusColor + ';font-weight:bold;">' + modalAgeSec + 's ago</span>';
	html += '</div>';
	html += '<div class="tab-content" style="padding:12px 15px;">';

	// Purpose tab
	html += '<div class="tab-pane active" id="chinampa-purpose">';

	// Combined Water Level chart (Fish Tank height + Sump Trough height), fixed to the last 24h,
	// full width, directly above the Fish Tank / Sump Trough cards. Loaded automatically (see
	// loadChinampaLevelChart, wired from buildTelepathonCardView) rather than via a button click.
	// This whole HTML string gets rebuilt from scratch on every pulse (see the comment on
	// loadChinampaLevelChart), so re-inject the last-rendered chart from the cache here instead
	// of always resetting to the loading placeholder — otherwise the chart would flash in for a
	// moment and then be wiped back to "Loading…" on the very next refresh.
	var levelContainerId = 'chinampa-level-chart-' + safeId;
	var cachedLevelChart = window.chinampaLevelChartCache && window.chinampaLevelChartCache[levelContainerId];
	var levelChartInnerHtml = cachedLevelChart ? cachedLevelChart.html :
		'<div style="text-align:center;color:#999;padding:20px;">Loading water level chart…</div>';
	html += '<div style="background:#f8f9fa;border-radius:8px;border-top:4px solid #3498db;padding:10px;margin-bottom:12px;">';
	html += '<div style="font-size:11px;text-transform:uppercase;font-weight:bold;color:#2c3e50;border-bottom:1px solid #eee;margin-bottom:8px;padding-bottom:4px;">Water Level (Last 24h)</div>';
	html += '<div id="' + levelContainerId + '">' + levelChartInnerHtml + '</div>';
	html += '</div>';

	html += '<div class="row">';

	// Fish Tank
	html += '<div class="col-xs-12 col-sm-6" style="margin-bottom:12px;">';
	html += '<div style="background:#f8f9fa;border-radius:8px;border-top:4px solid #3498db;padding:10px;">';
	html += '<div style="font-size:11px;text-transform:uppercase;font-weight:bold;color:#2c3e50;border-bottom:1px solid #eee;margin-bottom:8px;padding-bottom:4px;">Fish Tank (Pebble Mediate)</div>';
	html += '<div class="row"><div class="col-xs-5 text-center">';
	html += svgGauge(ftH ? ftH["Value"] : 1, ftM ? ftM["Value"] : 0, alertCode === 6);
	html += '<div style="font-size:9px;font-weight:bold;color:#777;margin-top:2px;">WATER LEVEL</div>';
	html += '<div style="margin-top:4px;">' + mkGraphBtns(tpName, "Purpose", "Fish Tank Measured Height") + '</div>';
	html += '</div><div class="col-xs-7">';
	html += metricBox(findDW(pw, "Fish Tank Outflow Flow Rate"), mkGraphBtns(tpName, "Purpose", "Fish Tank Outflow Flow Rate"));
	html += metricBox(findDW(pw, "Fish Tank Outflow Solenoid Relay Status"), mkGraphBtns(tpName, "Purpose", "Fish Tank Outflow Solenoid Relay Status"));
	html += metricBox(findDW(pw, "Seconds Since Last Fish Tank Data"));
	html += '</div></div></div></div>';

	// Sump Trough
	html += '<div class="col-xs-12 col-sm-6" style="margin-bottom:12px;">';
	html += '<div style="background:#f8f9fa;border-radius:8px;border-top:4px solid #3498db;padding:10px;">';
	html += '<div style="font-size:11px;text-transform:uppercase;font-weight:bold;color:#2c3e50;border-bottom:1px solid #eee;margin-bottom:8px;padding-bottom:4px;">Sump Trough</div>';
	html += '<div class="row"><div class="col-xs-5 text-center">';
	html += svgGauge(stH ? stH["Value"] : 1, stM ? stM["Value"] : 0, alertCode === 5 || alertCode === 6);
	html += '<div style="font-size:9px;font-weight:bold;color:#777;margin-top:2px;">WATER LEVEL</div>';
	html += '<div style="margin-top:4px;">' + mkGraphBtns(tpName, "Purpose", "Sump Trough Measured Height") + '</div>';
	html += '</div><div class="col-xs-7">';
	html += metricBox(findDW(pw, "Pump Flow Rate"), mkGraphBtns(tpName, "Purpose", "Pump Flow Rate"));
	html += metricBox(findDW(pw, "Pump Relay Status"), mkGraphBtns(tpName, "Purpose", "Pump Relay Status"));
	html += metricBox(findDW(pw, "Seconds Since Last Sump Trough Data"));
	html += '</div></div></div></div>';

	html += '</div>'; // end tanks row

	// Vitals — colored cards with history buttons below
	html += '<div class="row" style="margin-bottom:8px;">';
	if (outdoorTempDW) html += vitalCard("Outdoor Temp", outdoorTempDW["Value"], "°C", "#3498db", mkGraphBtns(tpName, "Purpose", "Outdoor Temperature"));
	if (outdoorHumDW) html += vitalCard("Outdoor Hum", outdoorHumDW["Value"], "%", "#3498db", mkGraphBtns(tpName, "Purpose", "Outdoor Humidity"));
	if (pcbDW) { var pcbV = parseFloat(pcbDW["Value"]); html += vitalCard("PCB Temp", pcbDW["Value"], "°C", pcbV > maxPCB ? "#e74c3c" : "#27ae60", mkGraphBtns(tpName, "Purpose", "PCB Temperature")); }
	if (rssiDW) { var rssiV = parseFloat(rssiDW["Value"]); html += vitalCard("Signal", rssiDW["Value"], "", rssiV > -95 ? "#27ae60" : "#f39c12", mkGraphBtns(tpName, "Purpose", "rssi")); }
	if (snrDW) { var snrV = parseFloat(snrDW["Value"]); html += vitalCard("SNR", snrDW["Value"], "", snrV > 0 ? "#27ae60" : "#f39c12", mkGraphBtns(tpName, "Purpose", "snr")); }
	html += '</div>';

	html += '</div>'; // end purpose tab-pane

	// Diagnostics tab (remaining purpose fields)
	var remainingPw = pw.filter(function(d) { return usedKeys.indexOf(d["Name"]) < 0; });
	html += '<div class="tab-pane" id="chinampa-diag">';
	var chinampaHardwareHtml = remainingPw.length > 0 ? denewordGrid(remainingPw, '#3498db') : '<p class="text-muted">No additional diagnostics.</p>';
	html += buildDiagnosticsSubTabs('chinampa-diag',
		buildVitalSignsPanel(telepathon, tpName, null, "chinampa", "v1.0-legacy"),  // wall powered: sleep/power groups stay empty
		chinampaHardwareHtml);
	html += '</div>';

	// Sensors tab
	html += '<div class="tab-pane" id="chinampa-sensors">';
	if (sensorsDene && sensorsDene["DeneWords"].length > 0) {
		html += denewordGrid(sensorsDene["DeneWords"], '#27ae60');
	} else {
		html += '<p class="text-muted">No sensor data available.</p>';
	}
	html += '</div>';

	// Configuration tab
	html += '<div class="tab-pane" id="chinampa-config">';
	if (configDene && configDene["DeneWords"].length > 0) {
		html += denewordGrid(configDene["DeneWords"], '#8e44ad');
	} else {
		html += '<p class="text-muted">No configuration data available.</p>';
	}
	html += '</div>';

	html += '</div>'; // end tab-content
	html += '</div>'; // end chinampa card
	return html;
}

// Annabelle herself (2026-11-01): the status her firmware (10+) adds to the AsyncData reply, read by the
// framework's AnnabelleStatusDeserializer - like the Diagnostics tab of her own page (annabelle.local).
function buildAnnabelleContent(telepathon) {
	var tpName = telepathon["Name"];
	var safeId = tpName.replace(/[^a-zA-Z0-9]/g, '_');
	var pw = [], cw = [];
	(telepathon["Denes"] || []).forEach(function(d) {
		if (d["Name"] === "Purpose") pw = d["DeneWords"] || [];
		if (d["Name"] === "Configuration") cw = d["DeneWords"] || [];
	});
	function find(words, n) {
		for (var i = 0; i < words.length; i++) if (words[i]["Name"] === n) return words[i];
		return null;
	}
	function val(n) { var w = find(pw, n); return w ? w["Value"] : null; }
	function num(n) { var v = parseFloat(val(n)); return isNaN(v) ? null : v; }
	function kb(n) { var v = num(n); return v === null ? '—' : Math.round(v / 1024) + ' KB'; }
	function duration(sec) { return sec === null ? '—' : deviceViewsFormatAge(sec).replace(' ago', ''); }
	function graphBtns(dwName) {
		var d = 'data-telepathonname="' + tpName + '" data-denename="Purpose" data-denewordname="' + dwName + '"';
		var c = 'btn btn-xs btn-default telepathon-history-value';
		return '<button class="' + c + '" ' + d + ' data-range="3600000">1h</button> ' +
			'<button class="' + c + '" ' + d + ' data-range="86400000">24h</button> ' +
			'<button class="' + c + ' hidden-xs" ' + d + ' data-range="604800000">7d</button>';
	}
	// a row: label, value as shown, and (optional) the dene word to chart
	function row(label, shown, chartWord) {
		return '<tr><td style="width:40%;">' + label + '</td><td><strong>' + shown + '</strong></td>' +
			'<td style="text-align:right;white-space:nowrap;padding:2px 4px;">' + (chartWord ? graphBtns(chartWord) : '') + '</td></tr>';
	}
	function table(rows) {
		return '<table class="table table-condensed table-striped" style="margin-bottom:0;font-size:12px;">' + rows + '</table>';
	}
	function tile(label, value, color) {
		return '<div class="col-xs-4 col-sm-2" style="margin-bottom:8px;padding:2px;"><div style="border-radius:10px;overflow:hidden;">' +
			'<div style="padding:8px 4px;color:white;text-align:center;background:' + color + ';">' +
			'<div style="font-size:9px;text-transform:uppercase;font-weight:bold;opacity:0.9;">' + label + '</div>' +
			'<div style="font-size:16px;font-weight:800;">' + value + '</div></div></div></div>';
	}
	function warn(text, bad) { return bad ? '<span style="color:#c62828;">' + text + '</span>' : text; }

	// Annabelle's clock is not UTC, so not her timestamps: the forecast's age at the reading (on her own clock),
	// plus the time since the reading ("Seconds Time", the Pi's)
	var nowSec = Date.now() / 1000;
	var readingTime = num("Seconds Time") || nowSec;
	var ageAtReading = num("Weather Forecast Age");
	var weatherSent = String(val("Weather Forecast Sent")) === "true";
	var weatherAge = ageAtReading !== null && ageAtReading >= 0 ? ageAtReading + Math.max(0, nowSec - readingTime) : null;
	var weatherTime = weatherAge !== null ? nowSec - weatherAge : null;
	var received = num("Packets Received") || 0, corrupted = num("Packets Corrupted") || 0;
	var corruptPct = received + corrupted ? Math.round(100 * corrupted / (received + corrupted)) : 0;
	var uptime = num("Uptime");
	var blockKb = num("Largest Free Block") === null ? null : num("Largest Free Block") / 1024;
	function perHour(n) { return uptime ? Math.round(n * 3600 / uptime) + ' / hour' : '—'; }

	var html = '<div style="padding:2px 0 10px 0;margin-top:-8px;border-bottom:1px solid #eee;margin-bottom:10px;font-size:13px;color:#888;">' +
		(val("Local Time") || '') + '&nbsp;&nbsp;Firmware ' + ((find(cw, "Firmware Version") || {})["Value"] || '—') + '</div>';

	html += '<ul class="nav nav-pills" style="margin-bottom:10px;">';
	html += '<li class="active" onclick="return teleonomeShowTab(\'anna-status-' + safeId + '\', this)"><a href="#">Status</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'anna-config-' + safeId + '\', this)"><a href="#">Config</a></li>';
	html += '</ul><div class="tab-content">';

	html += '<div class="tab-pane active" id="anna-status-' + safeId + '">';
	html += '<div class="row" style="margin-bottom:8px;">';
	html += tile('Up', duration(uptime), '#3498db');
	html += tile('Weather', weatherAge === null ? 'none' : duration(weatherAge), !weatherSent ? '#e74c3c' : (weatherAge > 6 * 3600 ? '#f39c12' : '#27ae60'));
	html += tile('Corrupted', corruptPct + '%', corruptPct >= 10 ? '#f39c12' : '#27ae60');
	html += tile('Free block', blockKb === null ? '—' : Math.round(blockKb) + ' KB', blockKb !== null && blockKb < 12 ? '#e74c3c' : '#27ae60');
	html += tile('WiFi drops', (num("WiFi Reconnects") || 0) + '', (num("WiFi Reconnects") || 0) > 0 ? '#f39c12' : '#27ae60');
	html += '</div>';

	var sub = 'font-size:12px;padding:3px 9px;';
	html += '<ul class="nav nav-pills" style="margin-bottom:8px;flex-wrap:wrap;">';
	html += '<li class="active" onclick="return teleonomeShowTab(\'anna-weather-' + safeId + '\', this)"><a href="#" style="' + sub + '">Weather</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'anna-radio-' + safeId + '\', this)"><a href="#" style="' + sub + '">Radio</a></li>';
	html += '<li onclick="return teleonomeShowTab(\'anna-health-' + safeId + '\', this)"><a href="#" style="' + sub + '">Health</a></li>';
	html += '</ul><div class="tab-content">';

	html += '<div class="tab-pane active" id="anna-weather-' + safeId + '">' + table(
		row('Last forecast', weatherTime && weatherTime > 0 ? new Date(weatherTime * 1000).toLocaleString() + ' <span style="color:#999;font-weight:normal;">(' + deviceViewsFormatAge(weatherAge) + ')</span>' : 'none since Annabelle started') +
		row('Result', warn(val("Weather Forecast Result") || '—', !weatherSent)) +
		row('Started by', val("Weather Trigger") || '—') +
		row('Retries', num("Weather Retries") === null ? '—' : num("Weather Retries")) +
		row('Waiting to send', String(val("Weather Pending")) === "true" ? 'yes' : 'no')) + '</div>';

	html += '<div class="tab-pane" id="anna-radio-' + safeId + '">' + table(
		row('Packets received', received + ' <span style="color:#999;font-weight:normal;">(' + perHour(received) + ')</span>', "Packets Received") +
		row('Corrupted packets', warn(corrupted + ' (' + corruptPct + '%)', corruptPct >= 10), "Packets Corrupted") +
		row('Dropped, queue full', warn(String(num("Packets Dropped") || 0), (num("Packets Dropped") || 0) > 0), "Packets Dropped") +
		row('Not listening', (num("Not Listening") === null ? '—' : num("Not Listening") + '%'), "Not Listening") +
		row('Sends', (num("Sends") || 0) + ' <span style="color:#999;font-weight:normal;">(weather forecasts and device commands)</span>', "Sends")) +
		'<p class="text-muted" style="font-size:11px;margin-top:6px;">Counted since Annabelle started, ' + duration(uptime) + ' ago.</p></div>';

	html += '<div class="tab-pane" id="anna-health-' + safeId + '">' + table(
		row('Up for', duration(uptime), "Uptime") +
		row('Last restart', val("Last Reset Reason") || '—') +
		row('Low-memory restarts', warn(String(num("Low Memory Restarts") || 0), (num("Low Memory Restarts") || 0) > 0)) +
		row('WiFi', ((num("WiFi Reconnects") || 0) ? warn(num("WiFi Reconnects") + ' reconnects', true) : 'no drops') +
			((num("WiFi Longest Gap") || 0) ? ', longest gap ' + duration(num("WiFi Longest Gap")) : ''), "WiFi Reconnects") +
		row('Free memory', kb("Free Memory") + ' <span style="color:#999;font-weight:normal;">(lowest ' + kb("Lowest Free Memory") + ')</span>', "Free Memory") +
		row('Largest free block', warn(kb("Largest Free Block"), blockKb !== null && blockKb < 12), "Largest Free Block") +
		row('Longest main loop', (num("Longest Main Loop") === null ? '—' : num("Longest Main Loop") + ' ms'), "Longest Main Loop") +
		row('Failed memory requests', warn(String(num("Failed Memory Requests") || 0), (num("Failed Memory Requests") || 0) > 0))) + '</div>';

	html += '</div></div>'; // sub tab-content, status pane

	html += '<div class="tab-pane" id="anna-config-' + safeId + '"><table class="table table-condensed table-striped" style="font-size:13px;">';
	cw.forEach(function(w) {
		html += '<tr><td style="width:50%;">' + w["Name"] + '</td><td><strong>' + w["Value"] + (w["Units"] ? ' ' + w["Units"] : '') + '</strong></td></tr>';
	});
	html += '</table></div>';
	html += '</div>'; // tab-content
	return html;
}
