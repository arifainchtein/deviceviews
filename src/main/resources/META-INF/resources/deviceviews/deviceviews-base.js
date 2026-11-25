// deviceviews: one look for a device, on the Teleonome and on devices.digitalstables.com (2026-10-31,
// DevicesDigitalStables design doc §18). Moved unchanged out of the Teleonome webapp (RenderingEngine.js,
// D3Chart.js, TimeUtils.js, TeleonomeConstants.js, index.html); what differs between the two hosts goes
// through DeviceViewsHost (deviceviews-base.js). Needs jQuery, Bootstrap 3 and d3 v7.

// ---- What each host provides. The defaults suit a page with no Teleonome around it; the Teleonome sets
// its own in DeviceViewsTeleonomeHost.js, devices.digitalstables.com in its device page scripts.
var DeviceViewsHost = {
	// The device type for a device name when the host knows it better than the telepathon ('' = use the
	// telepathon's own "Device Type Id").
	deviceType: function(name) { return ''; },
	// When the data was last refreshed, for devices whose telepathon has no "Local Time".
	pulseTimeMs: function() { return Date.now(); },
	// A Cerebellum value for a device (e.g. Daffodil's live battery SOC), or null when not known.
	setting: function(telepathonName, deneWordName) { return null; },
	// The device type's logo.
	logoUrl: function(deviceType) { return '/deviceviews/logos/' + deviceType + '.svg'; },
	// One dene word's history: req = {telepathon, nucleus, dene, deneWord, range (ms)}; callback(data) with
	// data = [{timeString: "YYYY-MM-DD HH:MM:SS" (local time), Value}], oldest first. onFail (optional) runs instead
	// when the host gave up waiting for an answer (the Teleonome's Hippocampus did not answer in time).
	fetchHistory: function(req, callback, onFail) { callback([]); },
	// Whether the device has a place on a map: true / false when the host knows (devices.digitalstables.com:
	// a location set on the device page counts), null to go by the telepathon's own Latitude / Longitude.
	isLocated: function(telepathon) { return null; },
	// The device's place, {latitude, longitude}, when the host knows it (devices.digitalstables.com: a location
	// set on the device page), null to go by the telepathon's own. Used for the solar mount's seasonal tilts.
	location: function(telepathon) { return null; },
	// One sentence after "no GPS position" saying how to place the device by hand on this host ('' = none).
	noLocationHint: function(telepathon) { return ''; }
};

// ---- GPS (2026-11-02): a device whose data arrives without a position is not on the map; say so ----
// The position in a telepathon: "Latitude" / "Longitude" in any dene (Langley writes "longitude" in
// lowercase), numbers in range and not 0,0 - the same rule devices.digitalstables.com's map uses
// (DevicePageServlet.putLocation). null when there is none.
function deviceViewsLocationOf(telepathon) {
	var lat = null, lon = null;
	((telepathon && telepathon["Denes"]) || []).forEach(function(d) {
		(d["DeneWords"] || []).forEach(function(w) {
			var n = String(w["Name"] || '').toLowerCase(), v = parseFloat(w["Value"]);
			if (isNaN(v)) return;
			if (n === 'latitude') lat = v;
			if (n === 'longitude') lon = v;
		});
	});
	if (lat === null || lon === null || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
	return {latitude: lat, longitude: lon};
}

function deviceViewsMissingLocation(telepathon) {
	var known = DeviceViewsHost.isLocated(telepathon);
	if (known === true || known === false) return !known;
	return deviceViewsLocationOf(telepathon) === null;
}

// A map pin struck through, in the current colour.
function deviceViewsNoGpsIcon(size) {
	return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" style="vertical-align:middle;" aria-hidden="true">' +
		'<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/>' +
		'<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
}

function deviceViewsNoGpsText(telepathon) {
	var hint = DeviceViewsHost.noLocationHint(telepathon);
	return 'Data is arriving, but this device sends no GPS position, so it is not on the map.' + (hint ? ' ' + hint : '');
}

// The look every card badge shares (No GPS, Relay): white bold text on a coloured pill.
function deviceViewsBadgeStyle(background) {
	return 'display:inline-block;background:' + background + ';color:#fff;border-radius:10px;padding:1px 6px 1px 4px;' +
		'font-size:10px;font-weight:bold;line-height:16px;white-space:nowrap;';
}

// On the card: a small badge, the full sentence as its tooltip ('' when it has a place). Placed by
// deviceViewsCardBadges, below.
function deviceViewsNoGpsBadge(telepathon) {
	if (!deviceViewsMissingLocation(telepathon)) return '';
	return '<span class="dv-nogps-badge" title="' + deviceViewsNoGpsText(telepathon).replace(/"/g, '&quot;') + '" ' +
		'style="' + deviceViewsBadgeStyle('#ef6c00') + '">' + deviceViewsNoGpsIcon(13) + ' No GPS</span>';
}

// At the top of the detail (the popup, and the device page itself).
function deviceViewsNoGpsBanner(telepathon) {
	if (!deviceViewsMissingLocation(telepathon)) return '';
	return '<div class="dv-nogps-banner" style="display:flex;align-items:center;gap:8px;background:#fff3e0;border:1px solid #ffb74d;' +
		'color:#8a4b00;border-radius:6px;padding:6px 10px;margin-bottom:10px;font-size:13px;">' +
		'<span style="color:#ef6c00;flex:0 0 auto;">' + deviceViewsNoGpsIcon(20) + '</span>' +
		'<span>' + deviceViewsNoGpsText(telepathon) + '</span></div>';
}

// ---- Relay (2026-11-13, Ari): the device's own relay mode is on - it resends other devices' packets ----
// Reported by the device itself (LangleyData.relayStatus -> Purpose "Relay Status"), so any Valentino-based
// device gets it: Langley now, Gloria next. Daffodils too since 2026-11-17 (DigitalStablesData.relayStatus,
// Annabelle token 59 -> the same Purpose "Relay Status"), e.g. Pool on mains. Not worked out from other devices' Routes - that is how packets
// arrived, not what the device is doing.
function deviceViewsIsRelay(telepathon) {
	var on = false;
	((telepathon && telepathon["Denes"]) || []).forEach(function(d) {
		if (d["Name"] !== "Purpose") return;
		(d["DeneWords"] || []).forEach(function(w) {
			if (w["Name"] === "Relay Status") on = String(w["Value"]).toLowerCase() === 'true' || String(w["Value"]) === '1';
		});
	});
	return on;
}

// Two arrows passing each other, in the current colour.
function deviceViewsRelayIcon(size) {
	return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" style="vertical-align:middle;" aria-hidden="true">' +
		'<path d="M4 7h12l-3.5-3.5L14 2l6 6-6 6-1.5-1.5L16 9H4z" fill="currentColor"/>' +
		'<path d="M20 17H8l3.5 3.5L10 22l-6-6 6-6 1.5 1.5L8 15h12z" fill="currentColor"/></svg>';
}

// On the card: white on blue ('' when relay is off). Placed by deviceViewsCardBadges, below.
function deviceViewsRelayBadge(telepathon) {
	if (!deviceViewsIsRelay(telepathon)) return '';
	return '<span class="dv-relay-badge" title="Relay on: this device resends other devices\' LoRa packets that need help." ' +
		'style="' + deviceViewsBadgeStyle('#1565c0') + '">' + deviceViewsRelayIcon(12) + ' Relay</span>';
}

// All the card's badges, at the bottom left of the logo (2026-11-13, Ari: below the logo, not above),
// one above the other so a device that is a relay with no GPS shows both ('' when there are none).
function deviceViewsCardBadges(telepathon) {
	var badges = [deviceViewsRelayBadge(telepathon), deviceViewsNoGpsBadge(telepathon)].filter(function(b) { return b; });
	if (!badges.length) return '';
	return '<div class="dv-card-badges" style="position:absolute;bottom:6px;left:6px;display:flex;flex-direction:column;' +
		'align-items:flex-start;gap:3px;">' + badges.join('') + '</div>';
}

// ---- Constants (moved from TeleonomeConstants.js) ----
// PulseTask output DeneWords (Purpose → Cerebellum → Daffodil)
var DENEWORD_PULSE_TASK_BATTERY_SOC_LIVE = "Battery SOC Live %";
// Cerebellum LedgerSoc (2026-10-12): SOC from the device's own battery ledger, published next to the above
var DENEWORD_LEDGER_SOC = "Battery SOC Ledger %";
var DENEWORD_LEDGER_CHARGE_MAH = "Battery Ledger Charge mAh";
var DENEWORD_LEDGER_LAST_ANCHOR = "Battery Ledger Last Anchor";
var TELEPATHON_DENE_VITAL_SIGNS = "Vital Signs";

// ---- Tables (moved from RenderingEngine.js) ----
var daffodilFunctionNames = {
	"1": "1 Flow Sensor", "2": "2 Flow Sensors", "3": "1 Flow + 1 Tank",
	"4": "1 Tank", "5": "2 Tanks", "6": "Septic Tank",
	"7": "Water Trough", "8": "Temp & Soil Moisture", "9": "Light Detector",
	"10": "Voltage Monitor", "11": "Water Trough + Tank", "12": "2 Water Troughs",
	"13": "Water Trough + Water Temperature"
};
var daffodilOperatingStatusNames = {"0": "Unknown", "1": "Pulse Sleep", "2": "No LED", "3": "Full", "4": "Cloudy", "5": "Comma"};

// Vital signs (reset / sleep / power / LoRa-TX telemetry) - the "Vital Signs" Dene each LoRa
// device's telepathon chain carries since 2026-10-05 (VitalSignsDeserializer.java). Shared by the
// Daffodil, Langley and Chinampa Diagnostics tabs. i2cBitNames decodes the device-specific
// "sensor found" mask (null = don't show it). Counters are running totals since the last reset.
var VITAL_SIGNS_BAD_RESETS = { "BROWNOUT": 1, "PANIC": 1, "INT_WDT": 1, "TASK_WDT": 1, "WDT": 1, "CPU_LOCKUP": 1, "PWR_GLITCH": 1 };

// ---- Tabs and popups (moved from RenderingEngine.js) ----
function teleonomeShowTab(paneId, clickedLi) {
	$(clickedLi).addClass('active').siblings('li').removeClass('active');
	$('#' + paneId).addClass('active').siblings('.tab-pane').removeClass('active');
	return false;
}

function openModal(id) {
	$('#' + id).modal('show');
}

function closeModal(id) {
	$('#' + id).modal('hide');
}

// "12s ago", "5m ago", "3h ago", "2d ago" (a copy of the Teleonome's formatPendingAge).
function deviceViewsFormatAge(ageSeconds) {
	if (ageSeconds < 60) return Math.floor(ageSeconds) + 's ago';
	if (ageSeconds < 3600) return Math.floor(ageSeconds / 60) + 'm ago';
	if (ageSeconds < 86400) return Math.floor(ageSeconds / 3600) + 'h ago';
	return Math.floor(ageSeconds / 86400) + 'd ago';
}

// ---- Transmission interval statistics for the chart's Comm Stats tab (moved from TimeUtils.js) ----
function analyzeTransmissionIntervals(data) {
    // Sort data by timeSeconds
    const sortedData = data.sort((a, b) => parseInt(a.timeSeconds) - parseInt(b.timeSeconds));
    
    // Initialize hourly data structure
    const hourlyIntervals = {
      hours: {},
      totalAverage: 0,
      totalCount: 0
    };
  
    // Initialize hours
    for (let i = 0; i < 24; i++) {
        hourlyIntervals.hours[i] = {
            intervals: [], // Store all intervals for this hour
            count: 0,
            average: 0,
            stdDev: 0,
            min: Infinity,
            max: -Infinity
        };
    }
    
    // Calculate intervals and group by hour
    let totalSum = 0;
    for (let i = 1; i < sortedData.length; i++) {
        const currentTime = parseInt(sortedData[i].timeSeconds);
        const previousTime = parseInt(sortedData[i-1].timeSeconds);
        const interval = currentTime - previousTime;
        
        // Use the hour of the current transmission
        const hour = new Date(currentTime * 1000).getHours();
        
        hourlyIntervals.hours[hour].intervals.push(interval);
        hourlyIntervals.hours[hour].count++;
        hourlyIntervals.hours[hour].min = Math.min(hourlyIntervals.hours[hour].min, interval);
        hourlyIntervals.hours[hour].max = Math.max(hourlyIntervals.hours[hour].max, interval);
  
        // Add to totals
        totalSum += interval;
        hourlyIntervals.totalCount++;
    }
    
    // Calculate statistics for each hour
    for (let hour = 0; hour < 24; hour++) {
        if (hourlyIntervals.hours[hour].count > 0) {
            // Calculate average
            const sum = hourlyIntervals.hours[hour].intervals.reduce((a, b) => a + b, 0);
            hourlyIntervals.hours[hour].average = sum / hourlyIntervals.hours[hour].count;
            
            // Calculate standard deviation
            if (hourlyIntervals.hours[hour].count > 1) {
                const mean = hourlyIntervals.hours[hour].average;
                const squareDiffs = hourlyIntervals.hours[hour].intervals.map(interval => {
                    const diff = interval - mean;
                    return diff * diff;
                });
                const avgSquareDiff = squareDiffs.reduce((sum, diff) => sum + diff, 0) / 
                                    (hourlyIntervals.hours[hour].count - 1);
                hourlyIntervals.hours[hour].stdDev = Math.sqrt(avgSquareDiff);
            }
        }
    }
  
    // Calculate total average
    hourlyIntervals.totalAverage = totalSum / hourlyIntervals.totalCount;
    
    return hourlyIntervals;
  }

// Helper function to format time in seconds to minutes:seconds
function formatTimeInterval(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.trunc(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
