# Entities

The backend manages several key entities. Below is an overview aligned with the current Mongoose schemas in `src/commons/schemas/`.

For a high-level introduction, see the [README](../README.md).

> **Note:** This document summarizes the main fields. For the authoritative schema, refer to the schema files in the repository. Entities not listed here but present in code include **Rule** (rule engine) and nested hook sub-documents on User, Booking, and GroupBooking.

### Tenant

A tenant represents a logical organization (e.g. a city, department or organization) that shares common access and configuration.

Example:

```json
{
  "id": "default",
  "name": "Example Name",
  "contactName": "Example Contact",
  "location": "Example Location",
  "mail": "example@example.com",
  "phone": "1234567890",
  "website": "https://example.com",
  "bookableDetailLink": "https://example.com/bookable-detail",
  "eventDetailLink": "https://example.com/event-detail",
  "genericMailTemplate": "<html>...</html>",
  "useInstanceMail": true,
  "noreplyMail": "example@example.com",
  "noreplyDisplayName": "Example Display Name",
  "noreplyHost": "smtp.example.com",
  "noreplyPort": 465,
  "noreplyUser": "smtp_user",
  "noreplyPassword": {},
  "noreplyStarttls": false,
  "noreplyUseGraphApi": false,
  "noreplyGraphTenantId": "GraphTenantId",
  "noreplyGraphClientId": "GraphClientId",
  "noreplyGraphClientSecret": {},
  "receiptTemplate": "<html>...</html>",
  "receiptNumberPrefix": "exmp",
  "receiptCount": { "2024": 1 },
  "receiptEnableBCC": false,
  "invoiceTemplate": "<html>...</html>",
  "invoiceNumberPrefix": "exmp",
  "invoiceCount": { "2024": 1 },
  "cancellationRefundTiers": [
    { "daysBeforeStart": 20, "refundPercentage": 100 },
    { "daysBeforeStart": 0, "refundPercentage": 50 }
  ],
  "paymentPurposeSuffix": "Example 123 4 56",
  "applications": [],
  "maxBookingAdvanceInMonths": 12,
  "defaultEventCreationMode": "simple",
  "enablePublicStatusView": true,
  "notifyOnNewBooking": true,
  "catalogParticipation": {
    "visible": true,
    "restricted": false
  },
  "legalDocuments": [
    {
      "type": "termsAndConditions",
      "title": "",
      "reference": { "source": "media", "mediaId": "8f1c2a44-…", "url": null }
    },
    {
      "type": "other",
      "title": "Hausordnung",
      "reference": {
        "source": "external",
        "mediaId": null,
        "url": "https://example.com/hausordnung.pdf"
      }
    }
  ]
}
```

> **Note:** Sensitive information (e.g. `noreplyPassword`, payment-related secrets) is stored encrypted in the database.

`cancellationRefundTiers` defines the tenant-wide refund proposal at cancellation time. Thresholds use calendar days in `Europe/Berlin`. An empty array preserves the default full refund. Below the lowest configured threshold, that tier continues to apply.

`legalDocuments` holds the legal documents of the tenant, in the same role the instance fields `dataProtection`, `legalNotice` and `termsAndConditions` play for the deployment as a whole. Unlike those it is a list of `{ type, title, reference }`, where `type` is one of `dataProtection`, `legalNotice`, `termsAndConditions`, `rightOfWithdrawal` or `other`. A known type appears at most once and carries no title — its label comes from the admin UI translation; `other` requires a title and no two `other` documents may share one. `reference` is a media reference: a `public` medium of the same tenant, or an external link. On the way out it carries the address it resolves to in `url`; the public tenant export does not include the field. Tenant documents are filed and maintained here, they are not delivered to end users.

### Roles

Roles define permission sets within a tenant.

Example:

```json
{
  "id": "admin",
  "name": "Administrator",
  "tenantId": "default",
  "adminInterfaces": [
    "locations",
    "users",
    "roles",
    "bookings",
    "coupons",
    "rooms",
    "resources",
    "tickets",
    "events",
    "media"
  ],
  "manageUsers": {
    "create": true,
    "readAny": true,
    "readOwn": true,
    "updateAny": true,
    "updateOwn": true,
    "deleteAny": true,
    "deleteOwn": true
  },
  "manageBookables": {
    "create": true,
    "readAny": true,
    "readOwn": true,
    "updateAny": true,
    "updateOwn": true,
    "deleteAny": true,
    "deleteOwn": true
  },
  "manageBookings": {
    "create": true,
    "readAny": true,
    "readOwn": true,
    "updateAny": true,
    "updateOwn": true,
    "deleteAny": true,
    "deleteOwn": true
  },
  "manageCoupons": {
    "create": true,
    "readAny": true,
    "readOwn": true,
    "updateAny": true,
    "updateOwn": true,
    "deleteAny": true,
    "deleteOwn": true
  },
  "manageMedia": {
    "create": true,
    "readAny": true,
    "readOwn": true,
    "updateAny": true,
    "updateOwn": true,
    "deleteAny": true,
    "deleteOwn": true
  },
  "manageRoles": {
    "create": true,
    "readAny": true,
    "readOwn": true,
    "updateAny": true,
    "updateOwn": true,
    "deleteAny": true,
    "deleteOwn": true
  },
  "assignedUserId": "someone@example.com",
  "freeBookings": true
}
```

### User

A user is an individual that can authenticate and interact with one or more tenants via memberships.

Example:

```json
{
  "id": "someone@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "1234567890",
  "address": "123 Main St",
  "zipCode": "12345",
  "city": "Example City",
  "company": "Example Company",
  "secret": "<hash>",
  "hooks": [],
  "isVerified": true,
  "created": 1658991377408,
  "isSuspended": false,
  "authType": "local",
  "keycloakId": "",
  "cardAuth": {},
  "legalAcceptance": {}
}
```

`authType` values include `local` and SSO types. `keycloakId` links SSO users. `cardAuth` stores card-based auth metadata. `legalAcceptance` records accepted legal documents per key.

### Bookable

Resources such as rooms, tickets, or other bookable objects with detailed attributes.

Example:

```json
{
  "id": "bkbl-123",
  "tenantId": "default",
  "type": "room",
  "title": "Example Title",
  "description": "Example Description",
  "isPublic": true,
  "imgUrl": "https://example.com/image.jpg",
  "flags": ["flag1", "flag2"],
  "tags": ["tag1", "tag2"],
  "location": {
    "coordinates": { "type": "Point", "points": [13.4, 52.5] },
    "display_address": "Example Street 1, 12345 Example City",
    "address": {
      "street": "Example Street",
      "house_number": "1",
      "post_code": "12345",
      "city": "Example City",
      "country": "Germany",
      "country_code": "DE"
    },
    "meta": {}
  },

  "isBookable": true,
  "amount": 10,
  "minBookingDuration": 30,
  "maxBookingDuration": 120,
  "autoCommitBooking": true,
  "bookingNotes": "Example Notes",
  "groupBooking": {
    "enabled": false,
    "permittedRoles": []
  },

  "isScheduleRelated": true,
  "isTimePeriodRelated": true,
  "timePeriods": [
    {
      "weekdays": [1, 2, 3],
      "startTime": "10:00",
      "endTime": "15:00"
    }
  ],
  "isOpeningHoursRelated": true,
  "openingHours": [
    {
      "weekdays": [1, 2, 3],
      "startTime": "08:00",
      "endTime": "18:00"
    }
  ],
  "preparationLeadTimeMinutes": 120,
  "serviceHours": [
    {
      "weekdays": [1, 2, 3, 4, 5],
      "startTime": "08:00",
      "endTime": "18:00"
    }
  ],
  "bufferTimeBeforeMinutes": 0,
  "bufferTimeAfterMinutes": 30,
  "isSpecialOpeningHoursRelated": false,
  "specialOpeningHours": [
    {
      "date": "2023-12-06",
      "startTime": "00:00",
      "endTime": "00:00"
    }
  ],
  "isLongRange": true,
  "longRangeOptions": {
    "type": "month"
  },
  "isBlockPeriodRelated": false,
  "blockPeriods": [],

  "priceCategories": [
    {
      "priceEur": 10.5,
      "interval": { "start": null, "end": null },
      "fixedPrice": false,
      "holidays": [],
      "weekdays": []
    }
  ],
  "priceType": "per-item",
  "priceValueAddedTax": 19,
  "enableCoupons": true,

  "requiresLogin": false,
  "permittedUsers": ["user1", "user2"],
  "permittedRoles": ["role1", "role2"],
  "bookingDiscounts": {
    "users": [{ "userId": "user3", "discountPercent": 100 }],
    "roles": [{ "roleId": "role3", "discountPercent": 50 }]
  },
  "cancellationPolicy": { "userCancellable": true, "contactHint": "" },

  "relatedBookableIds": ["bookable1", "bookable2"],
  "checkoutBookableIds": [{ "bookableId": "bookable2", "mandatory": false }],
  "eventId": "event1",
  "ownerUserId": "user1",

  "attachments": [
    {
      "id": "1",
      "title": "User manual",
      "caption": "",
      "type": "user-manual",
      "url": "https://.../manual.pdf",
      "show": true,
      "required": false,
      "mailAttach": false
    }
  ],
  "lockerDetails": {
    "active": false,
    "units": []
  },
  "requiredFields": ["address", "zipCode", "city"],
  "externalProviders": [],
  "customFieldDefinitions": [],
  "customFieldValues": [],

  "timeCreated": 1707994800000,
  "timeUpdated": 1708009200000
}
```

Key fields of a bookable:

| Field                        | Description                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id                           | Unique identifier of the bookable.                                                                                                                                                                                                                                 |
| tenantId                     | Tenant to which the bookable belongs.                                                                                                                                                                                                                              |
| type                         | Type of the bookable (e.g. `room`, `location`, `resource`, `ticket`).                                                                                                                                                                                              |
| title                        | Human readable title/name.                                                                                                                                                                                                                                         |
| description                  | Description of the bookable.                                                                                                                                                                                                                                       |
| location                     | Geo object with `coordinates`, `display_address`, `address`, and `meta` (same shape as Event location).                                                                                                                                                            |
| isPublic                     | If `false`, the bookable is hidden from public listings.                                                                                                                                                                                                           |
| isBookable                   | If `false`, the bookable cannot be checked out.                                                                                                                                                                                                                    |
| amount                       | Available capacity/amount. `null` means unlimited.                                                                                                                                                                                                                 |
| minBookingDuration           | Minimum booking duration in minutes (if schedule-related).                                                                                                                                                                                                         |
| maxBookingDuration           | Maximum booking duration in minutes (if schedule-related).                                                                                                                                                                                                         |
| autoCommitBooking            | If `true`, bookings are automatically committed / forwarded to payment.                                                                                                                                                                                            |
| isScheduleRelated            | If `true`, the user is asked to choose a booking time during checkout.                                                                                                                                                                                             |
| isTimePeriodRelated          | If `true`, the user selects one of the predefined `timePeriods`.                                                                                                                                                                                                   |
| timePeriods                  | Weekly repeating time windows when the bookable can be used.                                                                                                                                                                                                       |
| isOpeningHoursRelated        | If `true`, availability is derived from `openingHours`.                                                                                                                                                                                                            |
| openingHours                 | Regular opening hours per weekday.                                                                                                                                                                                                                                 |
| preparationLeadTimeMinutes   | Minimum preparation time in minutes before booking start. Lead-time enforcement is active when `isScheduleRelated`, `isTimePeriodRelated`, or `isBlockPeriodRelated` is `true`, `preparationLeadTimeMinutes` is greater than `0`, and `serviceHours` is non-empty. |
| serviceHours                 | Service windows when preparation can take place (same structure as `openingHours`, independent of opening hours). Only evaluated together with `preparationLeadTimeMinutes` on schedule-, time-period-, and block-period-related bookables.                        |
| bufferTimeBeforeMinutes      | Optional capacity buffer before each booking (minutes). Active only when `isScheduleRelated` is `true` and value is greater than `0`. Blocks back-to-back bookings in calendar and checkout capacity checks.                                                       |
| bufferTimeAfterMinutes       | Optional capacity buffer after each booking (minutes). Active only when `isScheduleRelated` is `true` and value is greater than `0`.                                                                                                                               |
| isSpecialOpeningHoursRelated | If `true`, `specialOpeningHours` override the regular opening hours for specific dates.                                                                                                                                                                            |
| specialOpeningHours          | Special opening hours for specific dates.                                                                                                                                                                                                                          |
| isLongRange                  | If `true`, long-range bookings (e.g. weeks/months) are enabled.                                                                                                                                                                                                    |
| longRangeOptions             | Configuration for long-range bookings (e.g. type = `week` or `month`).                                                                                                                                                                                             |
| isBlockPeriodRelated         | If `true`, availability uses `blockPeriods` (recurring weekday/time windows).                                                                                                                                                                                      |
| blockPeriods                 | Block periods with `id`, `label`, `startWeekday`, `startTime`, `endWeekday`, `endTime`.                                                                                                                                                                            |
| priceCategories              | List of price categories including price, interval, affected weekdays and holidays.                                                                                                                                                                                |
| priceType                    | Price type (e.g. `per-hour`, `per-day`, `per-item`, `per-square-meter`).                                                                                                                                                                                           |
| priceValueAddedTax           | VAT rate (in percent) applied to this bookable.                                                                                                                                                                                                                    |
| enableCoupons                | If `true`, coupons can be applied to this bookable.                                                                                                                                                                                                                |
| tags                         | Tags used for internal grouping and filtering.                                                                                                                                                                                                                     |
| flags                        | Feature flags highlighted to users (e.g. "barrier-free").                                                                                                                                                                                                          |
| relatedBookableIds           | IDs of bookables related to this bookable.                                                                                                                                                                                                                         |
| checkoutBookableIds          | Additional bookables for checkout: `{ bookableId, mandatory }`.                                                                                                                                                                                                    |
| requiresLogin                | If `true`, only authenticated users may book.                                                                                                                                                                                                                      |
| cancellationPolicy           | e.g. `{ userCancellable: true, contactHint: "" }` — whether users can cancel bookings themselves; `contactHint` is an optional message shown in emails when user cancellation is disabled.                                                                         |
| cancellationRefundTiers      | Not stored on the bookable. Public JSON responses (`/json/:tenant/bookables*`) attach the tenant’s refund tiers so clients can display the cancellation policy.                                                                                                    |
| permittedUsers               | List of user IDs that are allowed to book. If empty, every user including guests may book (depending on other rules).                                                                                                                                              |
| permittedRoles               | List of role IDs that are allowed to book. If empty, every user including guests may book (depending on other rules).                                                                                                                                              |
| bookingDiscounts             | Per-user and per-role booking discounts (`users[].userId`, `users[].discountPercent`, `roles[].roleId`, `roles[].discountPercent`; integer 0–100). Highest matching discount applies.                                                                              |
| attachments                  | Attachments: `id`, `title`, `caption`, `type`, `url`, `show`, `required`, `mailAttach`.                                                                                                                                                                            |
| lockerDetails                | Configuration for locker integrations (e.g. units).                                                                                                                                                                                                                |
| requiredFields               | Checkout fields required from the user (default: `address`, `zipCode`, `city`).                                                                                                                                                                                    |
| externalProviders            | External pricing/availability providers: `active`, `provider`, `handles`, `config`.                                                                                                                                                                                |
| customFieldDefinitions       | Tenant/bookable-level custom field definitions.                                                                                                                                                                                                                    |
| customFieldValues            | Stored values for custom fields on this bookable.                                                                                                                                                                                                                  |
| eventId                      | ID of the related event (for `ticket` bookables).                                                                                                                                                                                                                  |
| ownerUserId                  | ID of the user that owns/manages this bookable.                                                                                                                                                                                                                    |
| timeCreated                  | Timestamp when the bookable was created.                                                                                                                                                                                                                           |
| timeUpdated                  | Timestamp when the bookable was last updated.                                                                                                                                                                                                                      |

### Booking

A booking is a reservation of one or more bookables by a user (or guest).

Example:

```json
{
  "id": "BK-1234",
  "tenantId": "default",
  "assignedUserId": "user1",
  "attachments": [],
  "bookableItems": [],
  "comment": "Please provide a projector and whiteboard.",
  "internalComments": "Internal note",
  "rejectionReason": "",
  "company": "Some Corp",
  "couponCode": "COUPON123",
  "isCommitted": true,
  "isPayed": true,
  "isRejected": false,
  "location": "Anytown",
  "lockerInfo": [],
  "mail": "john.doe@example.com",
  "name": "John Doe",
  "paymentProvider": "stripe",
  "paymentMethod": "credit-card",
  "phone": "1234567890",
  "priceEur": 100,
  "street": "123 Main St",
  "timeBegin": 1707994800000,
  "timeCreated": 1707994800000,
  "timeEnd": 1708009200000,
  "timePaid": 1708002800000,
  "vatIncludedEur": 19,
  "_couponUsed": {},
  "customFieldValues": [],
  "cancellationPolicy": { "userCancellable": true, "contactHint": "" },
  "hooks": []
}
```

Key fields of a booking:

| Field              | Description                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| id                 | Unique identifier of the booking.                                                                                            |
| tenantId           | Tenant to which the booking belongs.                                                                                         |
| assignedUserId     | ID of the user who made the booking (may be empty for guest bookings).                                                       |
| timeBegin          | Start timestamp of the booking (epoch millis).                                                                               |
| timeEnd            | End timestamp of the booking (epoch millis).                                                                                 |
| timeCreated        | Timestamp when the booking was created.                                                                                      |
| timePaid           | Timestamp when the booking was paid (if applicable).                                                                         |
| bookableItems      | Array of booked items (bookable id, tenant, amount, and snapshot of the used bookable configuration).                        |
| couponCode         | Coupon code applied to the booking (if any).                                                                                 |
| \_couponUsed       | Snapshot of the used coupon (id, tenant, discount and validity).                                                             |
| priceEur           | Total price in Euro (without additional taxes).                                                                              |
| vatIncludedEur     | VAT amount included in `priceEur`.                                                                                           |
| isCommitted        | Whether the booking is committed (confirmed) from the system’s perspective.                                                  |
| isPayed            | Whether the booking has been paid.                                                                                           |
| isRejected         | Whether the booking has been rejected.                                                                                       |
| name               | Name of the person who made the booking.                                                                                     |
| company            | Company of the person who made the booking.                                                                                  |
| street             | Street address of the person who made the booking.                                                                           |
| zipCode            | Zip code of the person who made the booking.                                                                                 |
| location           | City or location of the person who made the booking.                                                                         |
| mail               | Email address of the person who made the booking.                                                                            |
| phone              | Phone number of the person who made the booking.                                                                             |
| comment            | Comment or special requests from the customer.                                                                               |
| internalComments   | Internal comments visible only to administrators.                                                                            |
| rejectionReason    | Reason why a booking has been rejected (if applicable).                                                                      |
| cancellationRefund | Persisted refund audit for the latest cancellation while the booking is rejected. Cleared when the cancellation is reverted. |
| attachments        | Attachments related to the booking. Cancellation attachments include the applied refund audit data described below.          |
| lockerInfo         | Information about locker assignments associated with this booking.                                                           |
| paymentProvider    | Identifier of the payment provider used (if any).                                                                            |
| paymentMethod      | Human readable payment method (e.g. credit card, invoice).                                                                   |
| hooks              | Technical hooks triggered for this booking (e.g. webhooks).                                                                  |

Cancellation attachments may contain a `cancellation` object with:

- `cancelledAt` and `daysBeforeStart`
- original, refunded and retained Euro amounts
- proposed and applied refund percentages
- the applied tier threshold
- origin (`user`, `admin`, or `system`) and administrator override status
- the acting administrator ID, when applicable
- a reference to the original invoice or receipt

The current tenant tiers are evaluated when the cancellation is finalized; the complete policy is not copied to the booking. Payment-provider refunds are not executed automatically.

### Coupon

Coupons represent discounts that can be applied to bookings.

Example:

```json
{
  "id": "STUDENT50",
  "tenantId": "default",
  "description": "50% discount for students",
  "type": "percentage",
  "discount": 50,
  "amount": 0,
  "maxAmount": 20,
  "usedAmount": 3,
  "validFrom": 1677668400000,
  "validTo": 1735685940000,
  "ownerUserId": "some@example.com"
}
```

### Event

Events are not considered bookables themselves. They describe real-world events (content, time, speakers, etc.) and can be linked to ticket bookables.

Example:

```json
{
  "id": "event-123",
  "tenantId": "default",
  "attachments": [],
  "attendees": {
    "publicEvent": true,
    "needsRegistration": false,
    "free": false,
    "maxAttendees": null,
    "priceCategories": []
  },
  "location": {
    "coordinates": {
      "type": "Point",
      "points": [null, null]
    },
    "display_address": "",
    "address": {
      "street": null,
      "house_number": null,
      "post_code": null,
      "city": null,
      "suburb": null,
      "state": null,
      "country": null,
      "country_code": null
    },
    "meta": {}
  },
  "eventLocation": {
    "name": "",
    "phoneNumber": "",
    "emailAddress": "",
    "select": null,
    "room": null,
    "url": ""
  },
  "eventOrganizer": {
    "name": "",
    "addContactPerson": true,
    "contactPersonName": "",
    "contactPersonPhoneNumber": "",
    "contactPersonEmailAddress": "",
    "contactPersonImage": "",
    "speakers": []
  },
  "format": 0,
  "images": [],
  "information": {
    "name": "",
    "teaserText": "",
    "description": "",
    "teaserImage": null,
    "startDate": "",
    "startTime": "",
    "endDate": "",
    "endTime": "",
    "tags": [],
    "flags": []
  },
  "isPublic": true,
  "schedules": [],
  "ownerUserId": "user-123",
  "externalBookingUrl": ""
}
```

`externalBookingUrl` links to an external booking page when the event is not booked through this platform.

### Instance

The Instance entity represents the global configuration for the entire deployment. There is only one instance per installation.

Example:

```json
{
  "applications": [],
  "mailTemplate": "<html>...</html>",
  "mailAddress": "contact@example.com",
  "noreplyMail": "noreply@example.com",
  "noreplyDisplayName": "No Reply",
  "noreplyHost": "smtp.example.com",
  "noreplyPort": 587,
  "noreplyUser": "noreply@example.com",
  "noreplyPassword": {},
  "noreplyStarttls": true,
  "noreplyUseGraphApi": false,
  "noreplyGraphTenantId": "",
  "noreplyGraphClientId": "",
  "noreplyGraphClientSecret": {},
  "mailEnabled": true,
  "contactAddress": "contact@example.com",
  "contactUrl": "https://example.com/contact",
  "dataProtection": {
    "source": "url",
    "url": "https://example.com/privacy",
    "fileName": ""
  },
  "legalNotice": {
    "source": "url",
    "url": "https://example.com/legal",
    "fileName": ""
  },
  "termsAndConditions": {
    "source": "file",
    "url": "https://backend.example.com/api/files/get?name=/public/legal/agb.pdf",
    "fileName": "agb.pdf"
  },
  "allowAllUsersToCreateTenant": false,
  "allowedUsersToCreateTenant": [],
  "ownerUserIds": ["admin@example.com"],
  "isInitialized": true,
  "userNotifications": [],
  "checkout": {
    "useLegacyCheckout": true,
    "checkoutUrl": ""
  },
  "publicOffersEnabled": false,
  "portalUrl": "",
  "branding": {
    "active": false,
    "theme": { "colors": { "primary": "", "secondary": "" } },
    "logoUrl": "",
    "faviconUrl": ""
  },
  "bookableCustomFields": []
}
```

> **Note:** `publicOffersEnabled` and `portalUrl` replace the legacy fields `enableCatalog` and `catalogUrl`. Instance-level **branding** (theme, logo) applies to catalogs and the public portal; it is not stored on the Catalog entity itself.

### GroupBooking

A GroupBooking entity represents a collection of related bookings that are managed together.

Example:

```json
{
  "id": "group-123",
  "tenantId": "default",
  "bookingIds": ["booking-1", "booking-2"],
  "assignedUserId": "user-123",
  "mail": "group@example.com",
  "internalComments": "",
  "timeCreated": 1707994800000,
  "hooks": []
}
```

### Application

Applications are embedded in the **Instance** or **Tenant** `applications` array. They are polymorphic: the `type` and `id` fields determine the shape.

Common base fields: `type`, `id`, `active`, `title`.

**Tenant application types:** `auth`, `payment`, `locker`, `card-auth`

**Instance application types:** `auth` (e.g. Keycloak SSO with `id: "keycloak"`)

Example (tenant auth / Keycloak):

```json
{
  "type": "auth",
  "id": "keycloak",
  "active": true,
  "title": "Keycloak SSO",
  "serverUrl": "https://auth.example.com",
  "realm": "booking",
  "publicClient": "storefront",
  "privateClient": "backend",
  "privateClientSecret": {},
  "roleMapping": {}
}
```

Example (tenant payment):

```json
{
  "type": "payment",
  "id": "ePayBL",
  "active": true,
  "title": "ePayBL",
  "merchantId": "..."
}
```

Payment `id` values include `ePayBL`, `pmPayment`, `giroCockpit`, and `invoice` — each with provider-specific fields.

### Workflow

A workflow describes a state machine that can be attached to bookings or other processes.

Example:

```json
{
  "tenantId": "default",
  "name": "Booking Approval",
  "description": "Workflow for approving bookings",
  "states": [
    {
      "id": "state-1",
      "name": "Pending",
      "actions": [],
      "tasks": []
    },
    {
      "id": "state-2",
      "name": "Approved",
      "actions": [],
      "tasks": []
    }
  ],
  "archive": [],
  "eventStateMapping": {
    "onCreate": "state-1",
    "onCommit": "state-2",
    "onReject": "",
    "onPay": "state-2"
  },
  "active": true
}
```

### Membership

Membership objects link a user to a tenant and describe the roles, ownership and onboarding state of that relationship.

Example:

```json
{
  "userId": "someone@example.com",
  "tenantId": "default",
  "roles": ["admin", "editor"],
  "owner": true,
  "status": "active",
  "source": "invite",
  "invitations": [
    {
      "token": "INV-123",
      "status": "completed",
      "reason": "User accepted the invite",
      "challengeStates": [
        {
          "challengeId": "chlg-terms",
          "status": "passed",
          "message": "Terms accepted",
          "updatedAt": "2024-01-01T12:00:00.000Z",
          "approvedBy": null
        }
      ]
    }
  ]
}
```

### Catalog

Catalogs define public listings of tenants and their resources. They can represent a single tenant, an aggregate over multiple tenants, or an instance-wide catalog.

Example:

```json
{
  "type": "single",
  "slug": "city-hall",
  "name": "City Hall Catalog",
  "tenantId": "default",
  "tenantIds": [],
  "excludedTenantIds": [],
  "active": true,
  "visibility": "public",
  "hero": {
    "title": "Welcome",
    "subtitle": "Book city resources online"
  }
}
```

Visual theme (colors, logo) is configured on **Instance.branding**, not on the catalog document.

For aggregate catalogs, `type` is set to `"aggregate"` and several tenant IDs are combined; for instance-wide catalogs `type` is `"instance"` and `tenantId`/`name`/`slug` are omitted.

### Challenge

Challenges are reusable building blocks for onboarding or verification flows (e.g. accepting terms, passing checks) that can assign roles when completed.

Example:

```json
{
  "id": "chlg-terms",
  "tenantId": "default",
  "key": "accept-terms",
  "enabled": true,
  "defaultConfig": {
    "url": "https://example.com/terms"
  },
  "label": "Accept Terms of Service",
  "description": "User must read and accept the current terms of service.",
  "rolesToAssign": ["member"]
}
```

### Invitation

Invitations grant users access to a tenant. They may assign roles and trigger challenges and can be single-use or multi-use links.

Example:

```json
{
  "tenantId": "default",
  "token": "INV-123",
  "type": "single",
  "maxUses": 1,
  "usedCount": 0,
  "challenges": ["chlg-terms"],
  "roles": ["member"],
  "intendedUserId": "someone@example.com",
  "expiresAt": 1735685940000,
  "status": "active"
}
```

### TokenSession

TokenSession documents track issued access/refresh tokens so they can be revoked or audited.

Example:

```json
{
  "jti": "d8b9c5c2-9c3b-4c23-9c39-2f3c9c3b9c3b",
  "userId": "someone@example.com",
  "tokenType": "refresh",
  "status": "active",
  "issuedAt": "2024-01-01T12:00:00.000Z",
  "expiresAt": "2024-02-01T12:00:00.000Z",
  "revokedAt": null,
  "revokeReason": null,
  "deviceId": "browser-abc-123"
}
```

### AccessPoint

Access points represent physical access integrations (e.g. lockers) linked to bookings.

Example:

```json
{
  "id": "ap-123",
  "tenant": "default",
  "type": "locker",
  "provider": "ilockit",
  "externalId": "locker-unit-42",
  "locationId": "building-a",
  "label": "Box 12",
  "metadata": {}
}
```

Types include `locker`. Providers are integration-specific (e.g. `ilockit`, `nuki`, `salto`).
