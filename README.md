# deviceviews

How a Digital Stables device looks on screen (its card, its detail popup and its 1h / 24h / 7d charts),
written once and used in two places:

- the **Teleonome webapp**: the farm's own page, served by the Teleonome (for example Annabelle's), with live data;
- **devices.digitalstables.com**: the page a product's QR code opens (`/d/<serial number>`) and the
  customer's page (`/<company>`), with data from the devices database.

## Why this project exists

Without it, the same JavaScript would sit in two webapps, and every change (a new tile on Langley's
popup, a fix to a chart) would have to be made twice and would drift apart. Here it lives once. Each
webapp adds this jar as a Maven dependency and gets the files at `/deviceviews/...`. It supplies only a
small *host* file that says where the data comes from.

The code was moved unchanged out of the Teleonome webapp on 2026-10-31, and the Teleonome page was
tested against live data afterwards with identical results. Design: `DevicesDigitalStables/docs/remote-device-control-design.md` §18.

## It only reads

deviceviews **never changes the Denome**, the Human Interface or any DeneWord. It takes a telepathon as
it is and draws it. The only message it causes is a history request:

- on the Teleonome, a `Hippocampus_Request` over MQTT, the same request the page sent before the move;
- on devices.digitalstables.com, a GET to `/d/<serial number>/api/history`.

The rest of the Teleonome page (the Human Interface, the Denome structure, the other nuclei) is not
part of this library and is unchanged.

## What is in it

There is no Java. Everything is under `src/main/resources/META-INF/resources/deviceviews/`, and any
Servlet 3 container (Tomcat 7+) serves it at `/deviceviews/...` straight from the jar in `WEB-INF/lib`.

| File | What it does |
|---|---|
| `deviceviews-base.js` | `DeviceViewsHost` (what each host must provide), constants, tables, tabs, popups, comm stats |
| `deviceviews-charts.js` | the d3 charts: `showTelepathonGraph`, `showTelepathonMultiGraph`, `showChinampaLevelGraph` |
| `deviceviews-history.js` | the chart popup, the 1h / 24h / 7d buttons, Chinampa's water level chart |
| `deviceviews-detail.js` | the detail popup for each device type: Daffodil, Langley, Chinampa, and a generic one |
| `deviceviews-card.js` | `buildTelepathonCardView(telepathon)`: the card, and the popup it opens |
| `deviceviews.css` | the chart and popup styles, for hosts other than the Teleonome |
| `logos/<Type>.svg` | one logo for each device type (Annabelle, Daffodil, Langley, Chinampa, Gloria, ...) |

## Using it in a webapp

1. Add the dependency:

   ```xml
   <dependency>
       <groupId>com.digitalstables</groupId>
       <artifactId>deviceviews</artifactId>
       <version>1.0.0</version>
   </dependency>
   ```

2. Load the scripts **in this order**, after jQuery 2, Bootstrap 3 and d3 v7:

   ```html
   <script src="/deviceviews/deviceviews-base.js"></script>
   <script src="/deviceviews/deviceviews-charts.js"></script>
   <script src="/deviceviews/deviceviews-history.js"></script>
   <script src="/deviceviews/deviceviews-detail.js"></script>
   <script src="/deviceviews/deviceviews-card.js"></script>
   <script src="YourHost.js"></script>
   ```

   The look is Bootswatch "Paper" 3.3.7. The Teleonome already uses it, and other hosts load it from
   cdnjs together with `/deviceviews/deviceviews.css`.

3. Provide the host (see below), then draw a device:

   ```js
   $('#devices').append(buildTelepathonCardView(telepathon));
   ```

## The host

Everything that differs between the two places goes through `DeviceViewsHost`. The defaults are in
`deviceviews-base.js`, and a host overrides what it needs:

| Function | Returns |
|---|---|
| `deviceType(name)` | the device type of a telepathon (Daffodil, Langley, ...) |
| `pulseTimeMs()` | the time of the last pulse |
| `setting(telepathonName, deneWordName)` | a Cerebellum setting for that device |
| `logoUrl(type)` | the logo to show |
| `fetchHistory({telepathon, nucleus, dene, deneWord, range}, callback)` | calls `callback([{timeString, timeSeconds, Value}, ...])` |

The hosts today:

- **Teleonome**: `DeviceViewsTeleonomeHost.js` in `teleonomewebapp`, which gets history from the Hippocampus over MQTT;
- **devices.digitalstables.com**: `devicepage-deviceviews.js` in `DevicesDigitalStables`, which gets it from the devices database.

The data is always a **telepathon**, the same JSON in both places:

```json
{ "Name": "...", "Denes": [ { "Name": "Purpose", "DeneWords": [ { "Name": "...", "Value": 0, "Units": "V" } ] } ] }
```

## Changing how a device looks

Edit the file once here. For a device type's popup that is `deviceviews-detail.js`, for example
`buildLangleyContent` for Langley; a type with no popup of its own uses the generic one. Then:

```sh
mvn install          # here first
```

and rebuild and deploy **both** webapps (`teleonomewebapp` on the Teleonome, and the
`DevicesDigitalStables` war). The change shows in each place once its webapp is redeployed.

## Build

```sh
mvn install
```

This makes a plain jar (`com.digitalstables:deviceviews:1.0.0`) with no dependencies. Build it before
either webapp.
