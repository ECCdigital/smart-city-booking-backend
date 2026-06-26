# Web Integration (JS Web Interface)

In addition to the standalone [Storefront](https://github.com/ECCdigital/smart-city-booking-store-front) and [Admin UI](https://github.com/ECCdigital/smart-city-booking-vue-app), Smart City Booking provides a **JavaScript web interface** for embedding bookables, events, calendars, and related components directly into **any existing website** — for example a city's CMS, WordPress, TYPO3, or a static HTML page. No Vue knowledge is required.

The script is built and shipped from the [vue-app repository](https://github.com/ECCdigital/smart-city-booking-vue-app) and connects to **this backend API**.

## How it works

| Piece | Role |
|-------|------|
| `booking-manager.min.js` | Client SDK — built by vue-app, served from the frontend host |
| Backend API (this repo) | Data source — bookables, events, availability, auth |
| Your website | Hosts placeholder HTML elements (`bm-*` classes) |

Source: [`src/js-web-interface/booking-manager-js.js`](https://github.com/ECCdigital/smart-city-booking-vue-app/blob/develop/src/js-web-interface/booking-manager-js.js) in the vue-app.

| Build command | Output | Purpose |
|---------------|--------|---------|
| `npm run build` | `./dist/cdn/current/booking-manager.min.js` | Production (served as CDN) |
| `npm run test-build` | `./public/cdn/current/booking-manager.min.js` | Local testing |

When the vue-app frontend is deployed, the script is reachable at:

```
https://<your-frontend-host>/cdn/current/booking-manager.min.js
```

> **v4 deployments:** Use the Storefront for a full public booking experience. The JS web interface remains **fully supported** for embedding individual components into existing websites alongside or instead of the Storefront.

## 1. Include the script

```html
<!-- Production: served from your vue-app / Storefront host -->
<script src="https://booking.my-city.de/cdn/current/booking-manager.min.js"></script>
```

## 2. Initialize the Booking Manager

```html
<script>
  const bm = new BookingManager();

  // Base URL of this backend API (same as VUE_APP_SERVER_BASE_URL in the frontend)
  bm.url = "https://api.my-city.de";

  // Tenant identifier
  bm.tenant = "my-tenant";

  window.addEventListener("load", () => {
    bm.init();
  });
</script>
```

`init()` loads the required [FullCalendar](https://fullcalendar.io/) libraries from a CDN, fetches data from the backend, and binds it to the placeholder elements below.

## 3. Place components

Add placeholder elements anywhere in your HTML. The Booking Manager fills them based on CSS class / `id` and `data-*` attributes. **Class** variants can be used multiple times per page; `id` variants exist for backwards compatibility and should appear only once.

| Element (class / id) | Configuration attributes | Description |
|----------------------|--------------------------|-------------|
| `.bm-bookable-list` | `data-type` (optional), `data-ids` (comma-separated, optional) | List of bookable objects |
| `.bm-bookable-item` | `data-id` **or** `data-id-param` (URL query parameter) | Detail view of a single bookable |
| `.bm-event-list` | `data-ids` (comma-separated, optional) | List of events |
| `.bm-event-item` | `data-id` **or** `data-id-param` | Detail view of a single event |
| `.bm-calendar` | `data-view` (`dayGridMonth` \| `timeGridWeek` \| …, default `dayGridMonth`) | Calendar showing all events |
| `.bm-occupancy-calendar` | `data-id` (comma-separated bookable IDs), `data-view` | Occupancy calendar for bookable(s) |
| `.bm-availability-calendar` | `data-id` (comma-separated bookable IDs), `data-view` | Calendar showing when bookable(s) are **not** available |

### Example — list, detail, and calendar

```html
<!-- List of bookable rooms -->
<div class="bm-bookable-list" data-type="room"></div>

<!-- Detail view — reads bookable id from URL parameter "id"
     e.g. https://my-city.de/detail?id=123 -->
<div class="bm-bookable-item" data-id-param="id"></div>

<!-- Event calendar in week view -->
<div class="bm-calendar" data-view="timeGridWeek"></div>
```

### Bookable list with filters

```html
<div
  class="bm-bookable-list"
  data-type="room"
  data-ids="bkbl-123,bkbl-345"
></div>
```

- **data-type** (optional) — Filter by bookable type (e.g. `room`)
- **data-ids** (optional) — Comma-separated list of bookable IDs

### Bookable item

```html
<div class="bm-bookable-item" data-id="bkbl-123"></div>
<!-- or -->
<div class="bm-bookable-item" data-id-param="bkm_id"></div>
```

## 4. Optional customization

Set these properties on the `BookingManager` instance **before** calling `init()`:

```html
<script>
  const bm = new BookingManager();
  bm.url = "https://api.my-city.de";
  bm.tenant = "my-tenant";

  // Link template for calendar events ({id} is replaced with the event id)
  bm.calendarHref = "https://my-city.de/event?id={id}";

  // Extra FullCalendar options, merged into the default configuration
  bm.calendar = {
    locale: "de",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek",
    },
  };

  window.addEventListener("load", () => bm.init());
</script>
```

Calendar loading indicators can be styled via CSS custom properties:

```css
:root {
  --bm-calendar-loading-bg: rgba(255, 255, 255, 0.8);
  --bm-calendar-loading-color: #333;
  --bm-calendar-loading-opacity: 0.6;
  --bm-calendar-primary-color: #3498db;
}
```

## Further reading

Full documentation including build and deployment of the script host:

- [vue-app README — Embedding on Your Own Website](https://github.com/ECCdigital/smart-city-booking-vue-app#embedding-on-your-own-website-js-web-interface)
