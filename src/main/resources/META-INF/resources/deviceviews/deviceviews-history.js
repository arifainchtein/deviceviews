// deviceviews: one look for a device, on the Teleonome and on devices.digitalstables.com (2026-10-31,
// DevicesDigitalStables design doc §18). Moved unchanged out of the Teleonome webapp (RenderingEngine.js,
// D3Chart.js, TimeUtils.js, TeleonomeConstants.js, index.html); what differs between the two hosts goes
// through DeviceViewsHost (deviceviews-base.js). Needs jQuery, Bootstrap 3 and d3 v7.

// The chart popup (#telepathon-graph-modal: Graph / Data / Comm Stats) and the 1h / 24h / 7d buttons.
// The data comes from DeviceViewsHost.fetchHistory: the Teleonome's Hippocampus over MQTT, or the devices
// database on devices.digitalstables.com.

// The popup's markup, as in the Teleonome's index.html; added only on pages that don't have it.
function deviceViewsEnsureGraphModal() {
	if (document.getElementById('telepathon-graph-modal')) return;
	$('body').append(
		'<div id="telepathon-graph-modal" class="modal fade" tabindex="-1">' +
		'<div class="modal-dialog modal-dialog-centered modal-fullscreen-sm-down" role="document"><div class="modal-content">' +
		'<div class="modal-header"><h5 id="telepathon-graph-title" class="modal-title">Modal Title</h5></div>' +
		'<div class="modal-body"><div>' +
		'<ul class="nav nav-tabs" role="tablist">' +
		'<li class="nav-item" role="presentation"><a id="graph-link" class="nav-link active" role="tab" data-toggle="tab" href="#telepathon-graph-panel">Graph</a></li>' +
		'<li class="nav-item" role="presentation"><a id="data-link" class="nav-link" role="tab" data-toggle="tab" href="#telepathon-data-panel">Data</a></li>' +
		'<li class="nav-item" role="presentation"><a id="telepathon-stats-link" class="nav-link" role="tab" data-toggle="tab" href="#telepathon-stats-panel">Comm Stats</a></li>' +
		'</ul><div class="tab-content">' +
		'<div id="telepathon-graph-panel" class="tab-pane active" role="tabpanel"><div id="telepathon-graph" class="graph-container"></div>' +
		'<div id="dataDisplay" class="bg-light mt-3 p-2 border rounded">Hover over points to see values</div></div>' +
		'<div id="telepathon-data-panel" class="tab-pane" role="tabpanel"><div id="telepathon-data" style="width:90%;margin:40px;overflow:auto;height:400px"></div></div>' +
		'<div id="telepathon-stats-panel" class="tab-pane" role="tabpanel"><div id="telepathon-stats" style="width:90%;margin:40px"></div></div>' +
		'</div></div></div>' +
		'<div class="modal-footer"><button class="btn btn-light" type="button" data-dismiss="modal">Close</button></div>' +
		'</div></div></div>');
}

// One series in the chart popup, with its Data and Comm Stats tabs (moved from the Teleonome's
// displayHippocampusResponse).
function deviceViewsShowHistory(telepathonName, deneWordName, data) {
	deviceViewsEnsureGraphModal();
	var results = analyzeTransmissionIntervals(data);

	var statsPanel='';
	statsPanel +='<div style="margin-right:10px;font-size:16px">Average Interval Between transmissions:' +Math.trunc(results.totalAverage) + " seconds</div>";
	statsPanel +='<table class="table table-striped text-center">';
	statsPanel +='<tr><th>Hour</th><th>Count</th><th>Avg(m:ss)</th><th>Std Dev</th><th>Min(m:ss)</th><th>Max(m:ss)</th></tr>';
	Object.entries(results.hours)
		.filter(([_, data]) => data.count > 0)
		.forEach(([hour, data]) => {
			if (data.min !== Infinity) {
				statsPanel +='<tr><td>'+hour.padStart(2, '0')+':00</td><td>'+data.count+'</td><td>' + formatTimeInterval(data.average)+'</td><td>' + data.stdDev.toFixed(2)+'</td><td>' + formatTimeInterval(data.min)+'</td><td>' + formatTimeInterval(data.max)+'</td></tr>';
			}
		});
	statsPanel +='<table>';

	var dataPanel = '';
	window.telepathonCsvExport = { name: telepathonName + "-" + deneWordName, data: data };
	dataPanel += '<div style="font-size:13px;margin-bottom:6px;color:#555;">There are ' + data.length + ' samples' +
		' <button type="button" class="btn btn-xs btn-primary telepathon-data-csv" style="margin-left:10px;">' +
		'<i class="glyphicon glyphicon-download-alt"></i> Download CSV</button></div>';
	dataPanel += '<table class="table table-striped table-condensed text-center" style="font-size:12px;">';
	dataPanel += '<tr><th>Time</th><th>Value</th><th>Time</th><th>Value</th></tr>';
	for (var dpi = 0; dpi < data.length; dpi += 2) {
		var left = data[dpi];
		var right = data[dpi + 1];
		dataPanel += '<tr><td>' + left.timeString + '</td><td>' + left.Value + '</td>';
		if (right) {
			dataPanel += '<td>' + right.timeString + '</td><td>' + right.Value + '</td>';
		} else {
			dataPanel += '<td></td><td></td>';
		}
		dataPanel += '</tr>';
	}
	dataPanel += '</table>';
	$('#telepathon-graph-modal .nav-link').on('click', function (e) {
		e.preventDefault()
		$(this).tab('show')
	})
	$('#telepathon-graph-modal').find('.nav-tabs .nav-link:first').tab('show')
	
	$('#telepathon-graph-title').html(telepathonName + "-"+deneWordName);
	$('#telepathon-graph').empty();
	showTelepathonGraph(data, window.lastTelepathonGraphRangeMs);
	$('#telepathon-stats').empty();
	$('#telepathon-stats').append(statsPanel);

	$('#telepathon-data').empty();
	$('#telepathon-data').append(dataPanel);
	$('#telepathon-graph-modal').modal('show');
	setTimeout(function() {
		$('#telepathon-graph-modal').css('z-index', 1060);
		$('.modal-backdrop').last().css('z-index', 1055);
	}, 0);

}

// "Download CSV" button in the Data tab of #telepathon-graph-modal. Exports the series last shown by
// displayHippocampusResponse (stashed in window.telepathonCsvExport), oldest-first as received.
$(document).on('click', '.telepathon-data-csv', function() {
	var exp = window.telepathonCsvExport;
	if (!exp || !exp.data) return;
	var esc = function(v) {
		var s = (v === null || v === undefined) ? '' : String(v);
		return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	};
	var csv = 'Time,Value\r\n';
	exp.data.forEach(function(d) {
		csv += esc(d.timeString) + ',' + esc(d.Value) + '\r\n';
	});
	var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
	var a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = exp.name.replace(/[^A-Za-z0-9_-]+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
});

// Renders a combined chart from a fully-collected window.telepathonMultiChartRequest buffer
// (see displayHippocampusResponse). Reuses the same #telepathon-graph-modal as the single-series
// path, but the per-point stats/data tables don't make sense across multiple series so those
// panes just get a placeholder note instead.
function displayHippocampusMultiResponse(req){
	deviceViewsEnsureGraphModal();

	var seriesArray = req.names.map(function(n, i) {
		return { name: n, units: req.units[i], data: req.received[n] || [] };
	});

	$('#telepathon-graph-modal .nav-link').on('click', function (e) {
		e.preventDefault()
		$(this).tab('show')
	})
	$('#telepathon-graph-modal').find('.nav-tabs .nav-link:first').tab('show')

	var heading = (req.mode === 'multiTelepathon') ? req.title : (req.telepathon + " - " + req.title);
	$('#telepathon-graph-title').html(heading);
	$('#telepathon-graph').empty();
	showTelepathonMultiGraph(seriesArray, req.range);

	$('#telepathon-stats').empty();
	$('#telepathon-stats').append('<div style="padding:10px;color:#777;">Combined chart — per-series stats not shown.</div>');

	$('#telepathon-data').empty();
	$('#telepathon-data').append('<div style="padding:10px;color:#777;">Combined chart — raw data table not shown.</div>');

	$('#telepathon-graph-modal').modal('show');
	setTimeout(function() {
		$('#telepathon-graph-modal').css('z-index', 1060);
		$('.modal-backdrop').last().css('z-index', 1055);
	}, 0);
}

// The 1h / 24h / 7d buttons (moved from the Teleonome's index.html, where they sent the Hippocampus_Request
// themselves). A single dene word:
$(document).on('click', '.telepathon-history-value', function() {
	var telepathon = $(this).data('telepathonname');
	var denename = $(this).data('denename');
	var denewordname = $(this).data('denewordname');
	var range = $(this).data('range');
	window.lastTelepathonGraphRangeMs = range;
	DeviceViewsHost.fetchHistory({telepathon: telepathon, nucleus: $(this).data('nucleus'), dene: denename,
			deneWord: denewordname, range: range}, function(data) {
		deviceViewsShowHistory(telepathon, denewordname, data);
	});
});

// A combined chart (see mkMultiGraphBtns): one request per dene word, drawn together once all are in.
$(document).on('click', '.telepathon-multi-history-value', function() {
	var telepathon = $(this).data('telepathonname');
	var denename = $(this).data('denename');
	var names = String($(this).data('denewordnames')).split(',');
	var units = String($(this).data('denewordunits')).split(',');
	var chartTitle = $(this).data('title') || 'Combined Chart';
	var range = $(this).data('range');
	var nucleus = $(this).data('nucleus');
	window.lastTelepathonGraphRangeMs = range;
	var req = {telepathon: telepathon, title: chartTitle, range: range, names: names, units: units, received: {}};
	names.forEach(function(dwName) {
		DeviceViewsHost.fetchHistory({telepathon: telepathon, nucleus: nucleus, dene: denename, deneWord: dwName, range: range},
			function(data) {
				req.received[dwName] = data;
				if (names.every(function(n) { return req.received.hasOwnProperty(n); })) displayHippocampusMultiResponse(req);
			});
	});
});

// Auto-loaded (no button click needed) fixed-24h combined Water Level chart shown inline in the
// Chinampa detail popup, above the Fish Tank / Sump Trough cards — see buildChinampaContent.
// Asks DeviceViewsHost.fetchHistory for both series and keeps its own buffer/container, rendering into
// the inline containerId instead of the shared #telepathon-graph-modal.
//
// IMPORTANT: the Chinampa detail modal's body is fully rebuilt from buildChinampaContent's HTML
// string on *every* incoming pulse (RefreshInterface -> refreshTelepathonsView ->
// buildTelepathonCardView -> $('#modalIdBody').html(...)), even while the modal is open — only
// #bannerformmodal blocks that refresh, not this modal. So the rendered chart SVG cannot simply
// be drawn into the container once; the very next pulse would wipe it back to a blank/loading
// div before anyone could see it. window.chinampaLevelChartCache holds the last-rendered chart
// markup per containerId so buildChinampaContent can re-inject it immediately on every rebuild
// (see there) instead of resetting to "Loading…", while the actual data is refreshed periodically
// (see the staleness check in buildTelepathonCardView) rather than on every single pulse.
window.chinampaLevelChartCache = window.chinampaLevelChartCache || {};

// seriesDefs: [{dwName, units, dash, heightValue, minValue, maxValue}, ...] — dash distinguishes
// which tank a line belongs to (solid Fish / dashed Sump), while heightValue/minValue/maxValue
// (the *current* sensor-mount height and Minimum/Maximum Level thresholds — see levelColor() and
// its comment) let showChinampaLevelGraph recolor each historical point red/green/blue by the
// same low/normal/high state as the summary card's squares, applying today's thresholds back
// across the 24h history since per-point historical thresholds aren't stored.
function loadChinampaLevelChart(tpName, containerId, seriesDefs) {
	if (!$('#' + containerId).length) return;
	if (window.chinampaLevelChartRequest && window.chinampaLevelChartRequest.containerId === containerId) return; // already in flight

	window.chinampaLevelChartRequest = {
		telepathon: tpName,
		containerId: containerId,
		range: 86400000,
		names: seriesDefs.map(function(s) { return s.dwName; }),
		seriesDefs: seriesDefs,
		received: {}
	};

	var req = window.chinampaLevelChartRequest;
	seriesDefs.forEach(function(s) {
		DeviceViewsHost.fetchHistory({telepathon: tpName, dene: "Purpose", deneWord: s.dwName, range: 86400000}, function(data) {
			if (window.chinampaLevelChartRequest !== req) return; // timed out or replaced
			req.received[s.dwName] = data;
			if (req.names.every(function(n) { return req.received.hasOwnProperty(n); })) renderChinampaLevelChart(req);
		});
	});

	// Safety valve: if a response never arrives (device offline, Hippocampus down, one of the
	// two denewords never replies), don't leave the in-flight guard above stuck forever.
	setTimeout(function() {
		if (window.chinampaLevelChartRequest && window.chinampaLevelChartRequest.containerId === containerId) {
			window.chinampaLevelChartRequest = null;
		}
	}, 20000);
}

function renderChinampaLevelChart(req) {
	window.chinampaLevelChartRequest = null;
	if (!$('#' + req.containerId).length) return; // popup closed/replaced before data arrived

	var seriesArray = req.seriesDefs.map(function(s) {
		return {
			name: s.dwName, units: s.units, dash: s.dash,
			heightValue: s.heightValue, minValue: s.minValue, maxValue: s.maxValue,
			data: req.received[s.dwName] || []
		};
	});

	$('#' + req.containerId).empty();
	showChinampaLevelGraph(seriesArray, req.range, req.containerId);

	window.chinampaLevelChartCache[req.containerId] = { html: $('#' + req.containerId).html(), ts: Date.now() };
}
