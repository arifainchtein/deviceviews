// deviceviews: one look for a device, on the Teleonome and on devices.digitalstables.com (2026-10-31,
// DevicesDigitalStables design doc §18). Moved unchanged out of the Teleonome webapp (RenderingEngine.js,
// D3Chart.js, TimeUtils.js, TeleonomeConstants.js, index.html); what differs between the two hosts goes
// through DeviceViewsHost (deviceviews-base.js). Needs jQuery, Bootstrap 3 and d3 v7.

// The telepathon charts (moved from D3Chart.js): one series, several series on two axes, and Chinampa's
// water level coloured by low / normal / high.

function showTelepathonGraph(data, rangeMs) {
	// Set dimensions 
	//d3.select("#telepathon-graph").html("");
	// Get container width - using getBoundingClientRect() for better compatibility
    const graphContainer = document.getElementById('telepathon-graph');
    const containerWidth = graphContainer ? graphContainer.getBoundingClientRect().width : 300; // fallback width if element not found
    
    // Set dimensions with responsive values
    const margin = {top: 20, right: 10, bottom: 50, left: 10};
    const width = Math.max(containerWidth - margin.left - margin.right, 400); // ensure minimum width
    const height = Math.min(400, window.innerHeight * 0.5) - margin.top - margin.bottom;
  
	// Parse time
	const parseTime = d3.timeParse("%Y-%m-%d %H:%M:%S");
	data = data.map(d => {
		var raw = d.Value;
		var num;
		if (typeof raw === 'string' && raw.toLowerCase() === 'true') num = 1;
		else if (typeof raw === 'string' && raw.toLowerCase() === 'false') num = 0;
		else num = +raw;
		return { time: parseTime(d.timeString), value: num };
	});
  
	// Create SVG
	const svg = d3.select("#telepathon-graph")
	.append("svg")
	.attr("width", "100%")
	.attr("height", height + margin.top + margin.bottom)
	.attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
	//.attr("preserveAspectRatio", "xMidYMid meet")
	.append("g")
	.attr("transform", `translate(${margin.left},${margin.top})`);

	// Set scales
	const x = d3.scaleTime()
	  .domain(d3.extent(data, d => d.time))
	  .range([0, width]);
  
	  // Filter outliers using 2nd-98th percentile so one bad value
	  // doesn't distort the Y axis scale for all the normal readings.
	  const sorted = data.map(d => d.value).slice().sort((a, b) => a - b);
	  const p2  = sorted[Math.max(0, Math.floor(sorted.length * 0.02))];
	  const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
	  const plotData = data.filter(d => d.value >= p2 && d.value <= p98);
	  const safeData = plotData.length > 0 ? plotData : data;

	  const minValue = d3.min(safeData, d => d.value);
	  const maxValue = d3.max(safeData, d => d.value);
	  const padding = (maxValue - minValue) * 0.1 || Math.abs(maxValue) * 0.1 || 1;
	  const y = d3.scaleLinear()
		  .domain([minValue - padding, maxValue + padding])
		  .range([height, 0]);
	
  
	// Add line
	const line = d3.line()
	  .x(d => x(d.time))
	  .y(d => y(d.value));
  
	svg.append("path")
	  .datum(safeData)
	  .attr("fill", "none")
	  .attr("stroke", "steelblue")
	  .attr("stroke-width", 1.5)
	  .attr("d", line);
  
	 // Add axes with responsive formatting
	 // For multi-day ranges (e.g. the 7d button), hourly ticks all land on
	 // midnight and would all read "00:00" — show the date instead.
	 const axisTickFormat = rangeMs > 86400000 ? d3.timeFormat("%d %b") : d3.timeFormat("%H:%M");
	 const xAxis = svg.append("g")
	 .attr("transform", `translate(0,${height})`)
	 .call(d3.axisBottom(x)
		 .ticks(width < 600 ? 4 : 8) // Reduced number of ticks
		 .tickFormat(axisTickFormat));

 // Adjust x-axis labels for better mobile display
 xAxis.selectAll("text")
	 .style("text-anchor", "end")
	 .attr("dx", "-.8em")
	 .attr("dy", ".15em")
	 .attr("transform", "rotate(-45)");

 svg.append("g")
	 .call(d3.axisLeft(y)
		 .ticks(height < 400 ? 5 : 8));

 // Add dots with data display update
 svg.selectAll("circle")
	 .data(safeData)
	 .enter().append("circle")
	 .attr("r", 3)
	 .attr("cx", d => x(d.time))
	 .attr("cy", d => y(d.value))
	 .attr("fill", "steelblue")
	 .on("mouseover", function(event, d) {
		 const timeFormat = d3.timeFormat("%H:%M:%S");
		 d3.select("#dataDisplay")
			 .html(`Time: ${timeFormat(d.time)} | Value: ${d.value}`);
		 
		 d3.select(this)
			 .attr("r", 6)
			 .attr("fill", "red");
	 })
	 .on("mouseout", function() {
		 d3.select(this)
			 .attr("r", 3)
			 .attr("fill", "steelblue");
	 });

 // Style data display
 d3.select("#dataDisplay")
	 .style("font-family", "monospace")
	 .style("font-size", "14px");
}

// Combined chart for the "Power Chart" / "Solar / Light Chart" buttons (see mkMultiGraphBtns
// in RenderingEngine.js). seriesArray: [{name, units, data: [{timeString, Value}, ...]}, ...] —
// same per-point shape as showTelepathonGraph's single-series `data`, just one array per series.
// Series are split across up to two Y axes grouped by units (first unit seen -> left axis,
// second -> right axis) since voltage and current/lux readings live on very different scales
// and would otherwise flatten one line against the other on a shared axis.
function showTelepathonMultiGraph(seriesArray, rangeMs, containerId) {
	containerId = containerId || 'telepathon-graph';
	const graphContainer = document.getElementById(containerId);
	const containerWidth = graphContainer ? graphContainer.getBoundingClientRect().width : 300;

	const legendRowHeight = 22;
	const margin = {top: 20, right: 55, bottom: 50 + (seriesArray.length * legendRowHeight), left: 55};
	const width = Math.max(containerWidth - margin.left - margin.right, 400);
	const height = Math.min(400, window.innerHeight * 0.5) - margin.top - margin.bottom;

	const parseTime = d3.timeParse("%Y-%m-%d %H:%M:%S");

	var unitOrder = [];
	seriesArray.forEach(function(s) {
		if (unitOrder.indexOf(s.units) === -1) unitOrder.push(s.units);
	});
	var leftUnit = unitOrder[0];
	var rightUnit = unitOrder.length > 1 ? unitOrder[1] : null;

	var series = seriesArray.map(function(s) {
		var values = (s.data || [])
			.filter(function(d) { return d.Value !== undefined && d.Value !== null && d.Value !== '' && !isNaN(+d.Value); })
			.map(function(d) { return { time: parseTime(d.timeString), value: +d.Value }; })
			.filter(function(d) { return d.time !== null; })
			.sort(function(a, b) { return a.time - b.time; });
		return { name: s.name, units: s.units, axis: (s.units === leftUnit ? 'left' : 'right'), values: values };
	});

	const svg = d3.select("#" + containerId)
		.append("svg")
		.attr("width", "100%")
		.attr("height", height + margin.top + margin.bottom)
		.attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
		.append("g")
		.attr("transform", `translate(${margin.left},${margin.top})`);

	var allValues = [];
	series.forEach(function(s) { allValues = allValues.concat(s.values); });
	if (allValues.length === 0) {
		svg.append("text").attr("x", width / 2).attr("y", height / 2).attr("text-anchor", "middle").text("No data");
		return;
	}

	const x = d3.scaleTime()
		.domain(d3.extent(allValues, d => d.time))
		.range([0, width]);

	function domainFor(unit) {
		var vals = [];
		series.filter(function(s) { return s.units === unit; }).forEach(function(s) {
			s.values.forEach(function(d) { vals.push(d.value); });
		});
		if (vals.length === 0) return [0, 1];
		var mn = d3.min(vals), mx = d3.max(vals);
		var pad = (mx - mn) * 0.1 || Math.abs(mx) * 0.1 || 1;
		return [mn - pad, mx + pad];
	}

	const yLeft = d3.scaleLinear().domain(domainFor(leftUnit)).range([height, 0]);
	const yRight = rightUnit ? d3.scaleLinear().domain(domainFor(rightUnit)).range([height, 0]) : null;

	const colors = d3.schemeTableau10;

	function lineFor(axis) {
		var yScale = axis === 'left' ? yLeft : yRight;
		return d3.line().x(d => x(d.time)).y(d => yScale(d.value));
	}

	series.forEach(function(s, i) {
		if (s.values.length === 0) return;
		svg.append("path")
			.datum(s.values)
			// .style(), not .attr() -- the app's global CSS has a bare `path { ... }` rule that
			// overrides SVG presentation attributes (see drawHippocampusPieChart's comment).
			.style("fill", "none")
			.style("stroke", colors[i % colors.length])
			.style("stroke-width", "2px")
			.attr("d", lineFor(s.axis));
	});

	const axisTickFormat = rangeMs > 86400000 ? d3.timeFormat("%d %b") : d3.timeFormat("%H:%M");
	const xAxis = svg.append("g")
		.attr("transform", `translate(0,${height})`)
		.call(d3.axisBottom(x)
			.ticks(width < 600 ? 4 : 8)
			.tickFormat(axisTickFormat));
	xAxis.selectAll("text")
		.style("text-anchor", "end")
		.attr("dx", "-.8em")
		.attr("dy", ".15em")
		.attr("transform", "rotate(-45)");

	svg.append("g").call(d3.axisLeft(yLeft).ticks(height < 400 ? 5 : 8));
	svg.append("text")
		.attr("text-anchor", "end").attr("x", -8).attr("y", -8)
		.style("font-size", "12px").text(leftUnit || '');

	if (rightUnit) {
		svg.append("g")
			.attr("transform", `translate(${width},0)`)
			.call(d3.axisRight(yRight).ticks(height < 400 ? 5 : 8));
		svg.append("text")
			.attr("text-anchor", "start").attr("x", width + 8).attr("y", -8)
			.style("font-size", "12px").text(rightUnit || '');
	}

	var legend = svg.append("g").attr("transform", `translate(0, ${height + 45})`);
	series.forEach(function(s, i) {
		var row = legend.append("g").attr("transform", `translate(0, ${i * legendRowHeight})`);
		row.append("rect").attr("width", 14).attr("height", 14).style("fill", colors[i % colors.length]);
		row.append("text").attr("x", 20).attr("y", 12).style("font-size", "13px")
			.text(s.name + (s.units ? ' (' + s.units + ')' : ''));
	});
}

// Chinampa "Water Level" chart (see loadChinampaLevelChart/renderChinampaLevelChart in
// RenderingEngine.js). Unlike showTelepathonMultiGraph, color here does NOT identify which
// series a line belongs to — it encodes the live red/green/blue low/normal/high state at each
// historical point (same bucketing as the summary card's colored squares — see levelColor()),
// recomputed per point from that series' *current* heightValue/minValue/maxValue (today's
// thresholds applied back across the 24h history, since historical thresholds aren't stored).
// Series identity is carried by line style instead (s.dash — solid Fish / dashed Sump), so each
// line is drawn as a run of short segments (one stroke color per segment) rather than one path.
// seriesArray: [{name, units, dash, heightValue, minValue, maxValue, data: [{timeString, Value}]}]
function showChinampaLevelGraph(seriesArray, rangeMs, containerId) {
	containerId = containerId || 'telepathon-graph';
	const graphContainer = document.getElementById(containerId);
	const containerWidth = graphContainer ? graphContainer.getBoundingClientRect().width : 300;

	const legendRowHeight = 22;
	// +1 extra legend row for the color-meaning key (Low/Normal/High), on top of one row per series.
	const margin = {top: 20, right: 20, bottom: 50 + ((seriesArray.length + 1) * legendRowHeight), left: 45};
	const width = Math.max(containerWidth - margin.left - margin.right, 400);
	const height = Math.min(400, window.innerHeight * 0.5) - margin.top - margin.bottom;

	const parseTime = d3.timeParse("%Y-%m-%d %H:%M:%S");

	function stateColor(heightValue, minValue, maxValue, measuredValue) {
		if (isNaN(heightValue) || isNaN(minValue) || isNaN(maxValue) || isNaN(measuredValue)) return '#95a5a6';
		var level = heightValue - measuredValue;
		if (level < minValue) return '#e74c3c';
		if (level > maxValue) return '#2060ff';
		return '#27ae60';
	}

	var series = seriesArray.map(function(s) {
		var values = (s.data || [])
			.filter(function(d) { return d.Value !== undefined && d.Value !== null && d.Value !== '' && !isNaN(+d.Value); })
			.map(function(d) {
				return { time: parseTime(d.timeString), value: +d.Value, color: stateColor(s.heightValue, s.minValue, s.maxValue, +d.Value) };
			})
			.filter(function(d) { return d.time !== null; })
			.sort(function(a, b) { return a.time - b.time; });
		return { name: s.name, units: s.units, dash: s.dash || '', values: values };
	});

	const svg = d3.select("#" + containerId)
		.append("svg")
		.attr("width", "100%")
		.attr("height", height + margin.top + margin.bottom)
		.attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
		.append("g")
		.attr("transform", `translate(${margin.left},${margin.top})`);

	var allValues = [];
	series.forEach(function(s) { allValues = allValues.concat(s.values); });
	if (allValues.length === 0) {
		svg.append("text").attr("x", width / 2).attr("y", height / 2).attr("text-anchor", "middle").text("No data");
		return;
	}

	const x = d3.scaleTime()
		.domain(d3.extent(allValues, d => d.time))
		.range([0, width]);

	var allNums = allValues.map(function(d) { return d.value; });
	var minVal = d3.min(allNums), maxVal = d3.max(allNums);
	var pad = (maxVal - minVal) * 0.1 || Math.abs(maxVal) * 0.1 || 1;
	const y = d3.scaleLinear().domain([minVal - pad, maxVal + pad]).range([height, 0]);

	// One <line> per consecutive point pair, colored by the state at its starting point, rather
	// than a single <path> per series — this is what lets stroke color change along the line.
	series.forEach(function(s) {
		for (var i = 0; i < s.values.length - 1; i++) {
			var p0 = s.values[i], p1 = s.values[i + 1];
			svg.append("line")
				.attr("x1", x(p0.time)).attr("y1", y(p0.value))
				.attr("x2", x(p1.time)).attr("y2", y(p1.value))
				.style("stroke", p0.color)
				.style("stroke-width", "2.5px")
				.style("stroke-dasharray", s.dash);
		}
	});

	const axisTickFormat = rangeMs > 86400000 ? d3.timeFormat("%d %b") : d3.timeFormat("%H:%M");
	const xAxis = svg.append("g")
		.attr("transform", `translate(0,${height})`)
		.call(d3.axisBottom(x).ticks(width < 600 ? 4 : 8).tickFormat(axisTickFormat));
	xAxis.selectAll("text")
		.style("text-anchor", "end").attr("dx", "-.8em").attr("dy", ".15em").attr("transform", "rotate(-45)");

	svg.append("g").call(d3.axisLeft(y).ticks(height < 400 ? 5 : 8));
	svg.append("text").attr("text-anchor", "end").attr("x", -8).attr("y", -8)
		.style("font-size", "12px").text((seriesArray[0] && seriesArray[0].units) || '');

	// Legend row per series (line style = which tank) ...
	var legend = svg.append("g").attr("transform", `translate(0, ${height + 45})`);
	series.forEach(function(s, i) {
		var row = legend.append("g").attr("transform", `translate(0, ${i * legendRowHeight})`);
		row.append("line").attr("x1", 0).attr("y1", 7).attr("x2", 26).attr("y2", 7)
			.style("stroke", "#555").style("stroke-width", "2.5px").style("stroke-dasharray", s.dash);
		row.append("text").attr("x", 32).attr("y", 12).style("font-size", "13px")
			.text(s.name + (s.units ? ' (' + s.units + ')' : ''));
	});
	// ... plus one row explaining what the segment color means, since color no longer identifies
	// the series here the way it does in showTelepathonMultiGraph.
	var colorLegendRow = legend.append("g").attr("transform", `translate(0, ${series.length * legendRowHeight})`);
	var swatches = [{c: '#e74c3c', t: 'Low'}, {c: '#27ae60', t: 'Normal'}, {c: '#2060ff', t: 'High'}];
	var sx = 0;
	swatches.forEach(function(sw) {
		colorLegendRow.append("rect").attr("x", sx).attr("y", 1).attr("width", 12).attr("height", 12).style("fill", sw.c);
		colorLegendRow.append("text").attr("x", sx + 16).attr("y", 11).style("font-size", "12px").text(sw.t);
		sx += 16 + sw.t.length * 6 + 16;
	});
}
