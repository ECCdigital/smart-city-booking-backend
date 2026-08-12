# Smart City Booking (Backend)

![Node.js](https://img.shields.io/badge/Node.js-blue)
![npm](https://img.shields.io/badge/npm-blue)
![Docker](https://img.shields.io/badge/Docker-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-blue)

**Smart City Booking** is an open-source booking platform designed specifically for smart cities and smart regions. It provides an efficient solution that allows citizens, organizations, and companies to book and manage resources offered by public administrations. With a wide range of configuration options, the platform can be adapted flexibly to meet individual requirements.

> **Note:** This repository contains the backend of the application. The frontend is maintained at:  
> [smart-city-booking-vue-app](https://github.com/ECCdigital/smart-city-booking-vue-app.git).

---

## Changelog

### Unreleased

1. **QR door access: scan-code QR generation & rotation**
   - New management endpoints for tenant owners:
     `GET /api/:tenant/accesspoints/:id/qrcode?format=svg|png|pdf` (default `svg`)
     renders the printable QR code, `POST /api/:tenant/accesspoints/:id/rotate-scan-code`
     retires the current scan code and mints a new one.
   - **Environment variables:** A new global `STORE_FRONT_URL` must be set. It is
     the public base URL of the store-front and is used to build the encoded
     scan URL `https://<STORE_FRONT_URL>/mobile-key/<tenant>/<scanCode>`. This is
     the store-front, not the Vue admin app that `FRONTEND_URL` points at.

### v3.4.0 (BREAKING)

**Important changes**

1. **Switching from session-based login to JWT-based authentication**  
   - The previous session/cookie logic has been replaced by JWT (JSON Web Token).  
   - After successfully logging in, clients must now transmit the returned JWT in subsequent requests (e.g. in the `Authorisation` header) instead of relying on a server-side session.  
   - Be sure to check your front-end/integration logic and adjust all auth flows (login, logout, token refresh, storage).  
   - **Environment variables:** The JWT configuration must now be provided via environment variables. Ensure the following keys are set in your `.env` file (or deployment environment): `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ALGORITHM`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `JWT_ISSUER`, `JWT_AUDIENCE`.

2. **Introduction of the membership entity to map user–tenant relationships**  
   - The user lists previously stored directly in the `Tenant` have been migrated to a new entity called **Membership**.  
   - The migration script `03-09-2025-migrate-users-to-memberships.js`
     - Creates a `Membership` document for each entry in `tenant.users` with the following fields:  
       `tenantId`, `userId`, `roles` (from the previous user object), `status = ‘active’`, `source = ‘invite’`.  
     - Creates or updates a membership with `owner = true` for all `tenant.ownerUserIds`.
     - Then removes the fields `users` and `ownerUserIds` from all `Tenant` documents.
   - **Consequence:**  
     - Code that previously accessed `tenant.users` or `tenant.ownerUserIds` must be converted to the `Membership` collection (e.g. queries for `tenantId` + `userId`, filters on `roles` or `owner`).
     - All new or existing features that affect a user's roles/affiliations with a tenant should be mapped exclusively via `Membership`.

---

## Overview

- **Technologies:** Node.js, npm, Docker, MongoDB
- **Purpose:** Provide a robust and flexible booking solution for public administrations
- **Focus:** User management, authentication, resource and booking management

---

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Database Configuration](#database-configuration)
3. [Initial Admin User](#initial-admin-user)
4. [Authentication](#authentication)
5. [API Overview](#api-overview)
6. [Entities](#entities)
7. [Web Integration](#web-integration)

---

## Installation & Setup

### Prerequisites

Ensure you have the following software installed on your system:

- [Node.js](https://nodejs.org/) (v14.17.0 or higher)
- [npm](https://www.npmjs.com/) (v6.14.13 or higher)
- [MongoDB](https://www.mongodb.com/) (v4.4 or higher)

### Installation Steps

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/ECCdigital/smart-city-booking-backend.git
   ```

2. **Navigate to the Project Directory:**

   ```bash
   cd smart-city-booking-backend
   ```

3. **Install Dependencies:**

   ```bash
   npm install
   ```

4. **Set Up Configuration:**

   Copy the `.env.example` file to `.env` and adjust the values to suit your environment:

   ```bash
   cp .env.example .env
   ```

   For example, configure your database settings in the `.env` file:

   ```bash
   DB_HOST=localhost
   DB_PORT=27017
   DB_NAME=smart-city-booking
   ```

   **Important:** Set the `CRYPTO_SECRET` variable to a secure value. This secret is used to encrypt sensitive data.

5. **Start the Application in Development Mode:**

   Ensure that your database instance is running and configured as above, then execute:

   ```bash
   npm run dev
   ```

---

## Database Configuration

The backend requires a MongoDB instance. This can be a local, remote, or Docker-based MongoDB server.  
Create a new database with the name specified in the `.env` file (using the `DB_NAME` variable).

---

## Initial Admin User

When starting the application for the first time, a default admin user is created.

**Default Credentials:**

- **Email:** admin
- **Password:** admin

You can change these defaults by setting the `INIT_ADMIN` and `INIT_ADMIN_SECRET` variables in your `.env` file.

---

## Authentication

The backend uses a local authentication strategy. User credentials (email and password) are verified against records stored in the database. Upon successful authentication, a session cookie is generated and stored on the user's device to maintain authentication across requests.

### Available Authentication Routes

- **POST /auth/signin**  
  _Purpose:_ Sign in a user  
  _Example Request Body:_

  ```json
  {
    "id": "someone@example.com",
    "password": "your-password"
  }
  ```

- **GET /auth/signout**  
  _Purpose:_ Sign out the currently authenticated user

- **POST /auth/signup**  
  _Purpose:_ Register a new user  
  _Example Request Body:_

  ```json
  {
    "id": "someone@example.com",
    "password": "your-password",
    "firstName": "First Name",
    "lastName": "Last Name"
  }
  ```

- **GET /auth/verify/:hookId**  
  _Purpose:_ Verify a user using the hook ID generated during signup

- **GET /auth/reset/:hookId**  
  _Purpose:_ Reset a user's password via a hook

- **POST /auth/resetpassword**  
  _Purpose:_ Update the password using the hook data  
  _Example Request Body:_

  ```json
  {
    "id": "someone@example.com",
    "password": "new-password"
  }
  ```

- **GET /auth/me**  
  _Purpose:_ Retrieve data of the currently authenticated user

---

## API Overview

The backend offers both public and protected API routes.

- **Public Routes:** Accessible without authentication.
- **Protected Routes:** Require a valid session or proper permissions.

### Example Endpoints

#### Tenants

- **GET /api/tenants**  
  Returns a list of all tenants. Without authentication, only public tenant information is provided.

- **PUT /api/tenants**  
  Creates or updates a tenant.  
  **Note:** A tenant can only be created if one of the following conditions is met:
  - `instance.allowAllUsersToCreateTenant` is set to `true`, or
  - The user is included in `instance.allowedUsersToCreateTenant`, or
  - The user is listed in `instance.ownerUserIds`.

---

- **DELETE /api/tenants/:id**  
  Deletes a tenant.  
  **Note:** A tenant can only be deleted if one of the following conditions is met:
  - The user is included in `tenant.ownerUserIds`, or
  - The user is listed in `instance.ownerUserIds`.

#### Roles

- **GET /api/roles**  
  Returns a list of all roles.  
  _Required Permission:_ role.allowRead

- **PUT /api/roles**  
  Creates or updates a role.  
  _Required Permission:_ role.allowCreate / role.allowUpdate

#### Bookables

- **GET /api/:tenant/bookables/public**  
  Returns a list of public bookable resources for a tenant.

- **PUT /api/:tenant/bookables**  
  Creates or updates a bookable resource.  
  _Required Permission:_ bookable.allowCreate / bookable.allowUpdate

- **DELETE /api/:tenant/bookables/:id**  
  Deletes a bookable resource.  
  _Required Permission:_ bookable.allowDelete

- **GET /api/:tenant/bookables/:id/occupancy**  
  Returns occupancy information for a specific bookable resource.  
  _Parameters:_
  - **id** (path): ID of the bookable resource
  - **timeBegin** (query, optional): Start time for the occupancy check (timestamp)
  - **timeEnd** (query, optional): End time for the occupancy check (timestamp)
  - **ignoreRelatedEntities** (query, optional): If set to true, related entities are ignored in the occupancy calculation (default: false)
  _Response:_ JSON object containing:
  - **bookableId**: ID of the bookable resource
  - **title**: Title of the bookable resource
  - **isAvailable**: Boolean indicating if the bookable is available in the specified time range
  - **totalCapacity**: Total capacity of the bookable
  - **booked**: Number of booked units
  - **remaining**: Number of remaining units

#### Other Categories

For endpoints related to events, users, bookings, coupons, checkout, payments, calendars, and files, refer to the detailed API documentation within this README. Each route includes parameter details, example request bodies, and required permissions.

---

## Entities

The backend manages several key entities. Below is an overview aligned with the current schemas.

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
  "paymentPurposeSuffix": "Example 123 4 56",
  "applications": [],
  "maxBookingAdvanceInMonths": 12,
  "defaultEventCreationMode": "simple",
  "enablePublicStatusView": true,
  "notifyOnNewBooking": true,
  "catalogParticipation": {
    "visible": true,
    "restricted": false
  }
}
```

> **Note:** Sensitive information (e.g. `noreplyPassword`, payment-related secrets) is stored encrypted in the database.

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
    "events"
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
  "authType": "local"
}
```

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
  "location": "Example Location",

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

  "permittedUsers": ["user1", "user2"],
  "permittedRoles": ["role1", "role2"],
  "freeBookingUsers": ["user3"],
  "freeBookingRoles": ["role3"],

  "relatedBookableIds": ["bookable1", "bookable2"],
  "checkoutBookableIds": [],
  "eventId": "event1",
  "ownerUserId": "user1",

  "attachments": [
    {
      "id": "1",
      "title": "User manual",
      "type": "user-manual",
      "url": "https://.../manual.pdf"
    }
  ],
  "lockerDetails": {
    "active": false,
    "units": []
  },
  "requiredFields": ["field1", "field2"],

  "timeCreated": 1707994800000,
  "timeUpdated": 1708009200000
}
```

Key fields of a bookable:

| Field                 | Description                                                                                                                                                 |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| id                    | Unique identifier of the bookable.                                                                                                                          |
| tenantId              | Tenant to which the bookable belongs.                                                                                                                       |
| type                  | Type of the bookable (e.g. `room`, `location`, `resource`, `ticket`).                                                                                       |
| title                 | Human readable title/name.                                                                                                                                  |
| description           | Description of the bookable.                                                                                                                                |
| location              | Location information shown to the user.                                                                                                                     |
| isPublic              | If `false`, the bookable is hidden from public listings.                                                                                                    |
| isBookable            | If `false`, the bookable cannot be checked out.                                                                                                             |
| amount                | Available capacity/amount. `null` means unlimited.                                                                                                         |
| minBookingDuration    | Minimum booking duration in minutes (if schedule-related).                                                                                                  |
| maxBookingDuration    | Maximum booking duration in minutes (if schedule-related).                                                                                                  |
| autoCommitBooking     | If `true`, bookings are automatically committed / forwarded to payment.                                                                                    |
| isScheduleRelated     | If `true`, the user is asked to choose a booking time during checkout.                                                                                    |
| isTimePeriodRelated   | If `true`, the user selects one of the predefined `timePeriods`.                                                                                           |
| timePeriods           | Weekly repeating time windows when the bookable can be used.                                                                                               |
| isOpeningHoursRelated | If `true`, availability is derived from `openingHours`.                                                                                                     |
| openingHours          | Regular opening hours per weekday.                                                                                                                          |
| isSpecialOpeningHoursRelated | If `true`, `specialOpeningHours` override the regular opening hours for specific dates.                                                              |
| specialOpeningHours   | Special opening hours for specific dates.                                                                                                                   |
| isLongRange           | If `true`, long-range bookings (e.g. weeks/months) are enabled.                                                                                            |
| longRangeOptions      | Configuration for long-range bookings (e.g. type = `week` or `month`).                                                                                    |
| priceCategories       | List of price categories including price, interval, affected weekdays and holidays.                                                                       |
| priceType             | Price type (e.g. `per-hour`, `per-day`, `per-item`, `per-square-meter`).                                                                                   |
| priceValueAddedTax    | VAT rate (in percent) applied to this bookable.                                                                                                            |
| enableCoupons         | If `true`, coupons can be applied to this bookable.                                                                                                       |
| tags                  | Tags used for internal grouping and filtering.                                                                                                             |
| flags                 | Feature flags highlighted to users (e.g. "barrier-free").                                                                                                |
| relatedBookableIds    | IDs of bookables related to this bookable.                                                                                                                 |
| checkoutBookableIds   | IDs of additional bookables that can be checked out together.                                                                                              |
| permittedUsers        | List of user IDs that are allowed to book. If empty, every user including guests may book (depending on other rules).                                     |
| permittedRoles        | List of role IDs that are allowed to book. If empty, every user including guests may book (depending on other rules).                                     |
| freeBookingUsers      | Users who can book this bookable for free.                                                                                                                 |
| freeBookingRoles      | Roles that can book this bookable for free.                                                                                                                |
| attachments           | Attachments shown with the bookable (id, title, type, url).                                                                                                |
| lockerDetails         | Configuration for locker integrations (e.g. units).                                                                                                       |
| requiredFields        | Additional fields that must be filled in during checkout.                                                                                                  |
| eventId               | ID of the related event (for `ticket` bookables).                                                                                                         |
| ownerUserId           | ID of the user that owns/manages this bookable.                                                                                                           |
| timeCreated           | Timestamp when the bookable was created.                                                                                                                   |
| timeUpdated           | Timestamp when the bookable was last updated.                                                                                                              |

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
  "hooks": []
}
```

Key fields of a booking:

| Field           | Description                                                                                                                           |
|-----------------|---------------------------------------------------------------------------------------------------------------------------------------|
| id              | Unique identifier of the booking.                                                                                                     |
| tenantId        | Tenant to which the booking belongs.                                                                                                  |
| assignedUserId  | ID of the user who made the booking (may be empty for guest bookings).                                                                |
| timeBegin       | Start timestamp of the booking (epoch millis).                                                                                        |
| timeEnd         | End timestamp of the booking (epoch millis).                                                                                          |
| timeCreated     | Timestamp when the booking was created.                                                                                               |
| timePaid        | Timestamp when the booking was paid (if applicable).                                                                                  |
| bookableItems   | Array of booked items (bookable id, tenant, amount, and snapshot of the used bookable configuration).                                |
| couponCode      | Coupon code applied to the booking (if any).                                                                                          |
| _couponUsed     | Snapshot of the used coupon (id, tenant, discount and validity).                                                                      |
| priceEur        | Total price in Euro (without additional taxes).                                                                                       |
| vatIncludedEur  | VAT amount included in `priceEur`.                                                                                                     |
| isCommitted     | Whether the booking is committed (confirmed) from the system’s perspective.                                                           |
| isPayed         | Whether the booking has been paid.                                                                                                    |
| isRejected      | Whether the booking has been rejected.                                                                                                |
| name            | Name of the person who made the booking.                                                                                              |
| company         | Company of the person who made the booking.                                                                                           |
| street          | Street address of the person who made the booking.                                                                                    |
| zipCode         | Zip code of the person who made the booking.                                                                                          |
| location        | City or location of the person who made the booking.                                                                                  |
| mail            | Email address of the person who made the booking.                                                                                     |
| phone           | Phone number of the person who made the booking.                                                                                      |
| comment         | Comment or special requests from the customer.                                                                                        |
| internalComments| Internal comments visible only to administrators.                                                                                     |
| rejectionReason | Reason why a booking has been rejected (if applicable).                                                                              |
| attachments     | Attachments related to the booking.                                                                                                   |
| lockerInfo      | Information about locker assignments associated with this booking.                                                                    |
| paymentProvider | Identifier of the payment provider used (if any).                                                                                     |
| paymentMethod   | Human readable payment method (e.g. credit card, invoice).                                                                           |
| hooks           | Technical hooks triggered for this booking (e.g. webhooks).                                                                          |

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
  "eventAddress": {
    "street": "",
    "houseNumber": "",
    "additional": "",
    "city": "",
    "zip": ""
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
  "ownerUserId": "user-123"
}
```

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
  "dataProtectionUrl": "https://example.com/privacy",
  "legalNoticeUrl": "https://example.com/legal",
  "allowAllUsersToCreateTenant": false,
  "allowedUsersToCreateTenant": [],
  "ownerUserIds": ["admin@example.com"],
  "isInitialized": true,
  "userNotifications": [],
  "enableCatalog": false,
  "catalogUrl": ""
}
```

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
  "timeCreated": 1707994800000,
  "hooks": []
}
```

### Application

Applications are stored as part of the instance or tenant configuration and represent external integrations (e.g. SSO, payment).

Example (instance-level application entry):

```json
{
  "id": "app-123",
  "name": "SSO Provider",
  "type": "auth",
  "clientId": "client-123",
  "clientSecret": {},
  "redirectUris": ["https://example.com/callback"],
  "tenantId": "default"
}
```

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
  "theme": {
    "active": true,
    "colors": {
      "primary": "#0055aa",
      "secondary": "#00aa55"
    }
  }
}
```

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

---

## Web Integration

The backend provides a web interface and a JavaScript SDK for integrating data (bookables, events, etc.) into websites. The SDK asynchronously loads data from the backend and dynamically injects HTML components that can be styled with CSS.

### Setting Up the Web Interface

Include the following script in your HTML file:

```html
<script src="https://demo1.smart-city-booking.de/cdn/current/booking-manager.min.js"></script>
<script>
  const bm = new BookingManager();
  bm.url = "https://demo1.smart-city-booking.de";
  bm.tenant = "default";
  window.addEventListener("load", () => {
    bm.init();
  });
</script>
```

### Examples of Web Components

#### Bookable List

```html
<div
  class="bm-bookable-list"
  data-type="room"
  data-ids="bkbl-123,bkbl-345"
></div>
```

_Parameters:_

- **data-type (optional):** Filters bookables by type (e.g., "room").
- **data-ids (optional):** Comma-separated list of bookable IDs.

#### Bookable Item

```html
<div class="bm-bookable-item" data-id="bkbl-123" data-id-param="bkm_id"></div>
```

_Parameters:_

- **data-id:** ID of the bookable item.
- **data-id-param:** Name of the URL parameter that supplies the bookable ID (if available).

#### Event List & Event Item

Similar to the bookable components. For example, an event list:

```html
<div class="bm-event-list" data-ids="evt-123,evt-234"></div>
```

#### Calendar and Other Components

Detailed examples for event and occupancy calendars, login forms, logout buttons, user profile forms, and bookings tables are provided in the original documentation.

---

## Summary

This README provides a comprehensive guide for setting up, configuring, and using the Smart City Booking backend. It includes:

- Clear instructions for setting up your development environment.
- Detailed API documentation with permission requirements.
- Descriptions of core entities and examples for web integration.

---
