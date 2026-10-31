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
	// data = [{timeString: "YYYY-MM-DD HH:MM:SS" (local time), Value}], oldest first.
	fetchHistory: function(req, callback) { callback([]); }
};

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
