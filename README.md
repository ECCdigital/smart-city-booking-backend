# Smart City Booking (Backend)

![Node.js](https://img.shields.io/badge/Node.js-blue)
![npm](https://img.shields.io/badge/npm-blue)
![Docker](https://img.shields.io/badge/Docker-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-blue)

**Smart City Booking** is an open-source booking platform designed specifically for smart cities and smart regions. It provides an efficient solution that allows citizens, organizations, and companies to book and manage resources offered by public administrations. With a wide range of configuration options, the platform can be adapted flexibly to meet individual requirements.

> **Note:** This repository contains the backend of the application. The frontend is maintained at:  
> [smart-city-booking-vue-app](https://github.com/ECCdigital/smart-city-booking-vue-app.git).

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

#### Other Categories

For endpoints related to events, users, bookings, coupons, checkout, payments, calendars, and files, refer to the detailed API documentation within this README. Each route includes parameter details, example request bodies, and required permissions.

---

## Entities

The backend manages several key entities. Below is an overview:

### Tenant

A tenant represents a group of users sharing common access and configurations.  
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
  "useInstanceMail": false,
  "noreplyMail": "example@example.com",
  "noreplyDisplayName": "Example Display Name",
  "noreplyHost": "smtp.example.com",
  "noreplyPort": "465",
  "noreplyUser": "smtp_user",
  "noreplyPassword": {},
  "noreplyStarttls": false,
  "noreplyUseGraphApi": false,
  "noreplyGraphTenantId": "GraphTenantId",
  "noreplyGraphClientId": "GraphClientId",
  "noreplyGraphClientSecret": "GraphClientSecret",
  "receiptTemplate": "<html>...</html>",
  "receiptNumberPrefix": "exmp",
  "receiptCount": { "2024": 1 },
  "invoiceTemplate": "<html>...</html>",
  "invoiceNumberPrefix": "exmp",
  "invoiceCount": { "2024": 1 },
  "paymentPurposeSuffix": "Example 123 4 56",
  "applications": [],
  "maxBookingAdvanceInMonths": 12,
  "defaultEventCreationMode": "simple",
  "enablePublicStatusView": true,
  "ownerUserIds": ["john.doe@example.com"]
}
```

> **Note:** Sensitive information (e.g., `noreplyPassword`, `paymentSecret`) is stored encrypted.

### Roles

Define sets of permissions and are shared across tenants.

Example:

```json
{
  "id": "default",
  "name": "Example Name",
  "adminInterfaces": [
    "locations",
    "roles",
    "bookings",
    "coupons",
    "rooms",
    "resources",
    "tickets",
    "events"
  ],
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

An individual who can perform actions as permitted by their roles.

Example:

```json
{
  "id": "default",
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
  "isSuspended": false,
  "created": 1658991377408
}
```

### Bookable
Resources such as rooms, tickets, or other bookable objects with detailed attributes.

Example:

```json
{
  "id": "default",
  "tenantId": "default",
  "type": "room",
  "enabled": true,
  "parent": "123-123ada-123",
  "title": "Example Title",
  "description": "Example Description",
  "flags": ["flag1", "flag2"],
  "imgUrl": "https://example.com/image.jpg",
  "priceEuro": 10.5,
  "priceValueAddedTax": 19,
  "amount": 10,
  "minBookingDuration": 30,
  "maxBookingDuration": 120,
  "autoCommitBooking": true,
  "location": "Example Location",
  "tags": ["tag1", "tag2"],
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
  "permittedUsers": ["user1", "user2"],
  "permittedRoles": ["role1", "role2"],
  "freeBookingUsers": ["user3"],
  "freeBookingRoles": ["role3"],
  "eventId": "event1",
  "attachments": [
    {
      "id": "1",
      "title": "User manual",
      "type": "user-manual",
      "url": "https://.../manuel.pdf"
    }
  ],
  "priceCategory": "per-hour",
  "relatedBookableIds": ["bookable1", "bookable2"],
  "isBookable": true,
  "isPublic": true,
  "lockerDetails": {},
  "requiredFields": ["field1", "field2"],
  "bookingNotes": "Example Notes",
  "checkoutBookableIds": ["bookable3", "bookable4"],
  "ownerUserId": "user1",
}
```

Here is a table that describes the fields in the bookable object:

| Field                        | Description                                                                                                                                                               |
|------------------------------| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                           | The unique identifier of the bookable.                                                                                                                                    |
| tenantId                     | The tenant to which the bookable belongs.                                                                                                                                 |
| type                         | The type of the bookable (e.g., room, event location, resource, ticket).                                                                                                  |
| title                        | The title or name of the bookable.                                                                                                                                        |
| description                  | A description of the bookable.                                                                                                                                            |
| location                     | The location of the bookable.                                                                                                                                             |
| priceEur                     | The price of the bookable in Euros.                                                                                                                                       |
| priceCategory                | The category of the price (e.g. per-hour, per-item, per-day).                                                                                                             |
| amount                       | The available amount of the bookable. Unlimited if undefined.                                                                                                             |
| isScheduleRelated            | A boolean indicating if the bookable is related to a schedule. If true, the user is promted to choose a booking time in the checkout.                                     |
| isTimePeriodRelated          | A boolean indicating if the bookable is related to a time period. If true, the user is prompted to select one of the predefined time periods.                             |
| timePeriods                  | An array of repeating time periods within a week during which the bookable is available. Each time period has weekdays, a start time, and an end time.                    |
| minBookingDuration           | The minimum booking duration for the bookable.                                                                                                                            |
| maxBookingDuration           | The maximum booking duration for the bookable.                                                                                                                            |
| autoCommitBooking            | A boolean indicating if the booking is automatically committed respecively the user is automatically directed into payment.                                               |
| attachments                  | An array of attachments related to the bookable. Each attachment has an id, title, type, and url.                                                                         |
| isOpeningHoursRelated        | A boolean indicating if the bookable is dependent to opening hours.                                                                                                       |
| openingHours                 | An array of opening hours for the bookable. Each opening hour has weekdays, a start time, and an end time.                                                                |
| isSpecialOpeningHoursRelated | A boolean indicating if the bookable has special opening hours.                                                                                                           |
| specialOpeningHours          | An array of special opening hours for the bookable. Each special opening hour has a date, start time, and end time.                                                       |
| tags                         | An array of tags associated with the bookable. Used for internal clustering.                                                                                              |
| flags                        | An array of flags associated with the bookable. Used to present important features of this bookable to the user.                                                          |
| eventId                      | The id of the event associated with the bookable. (Only for type = ticket)                                                                                                |
| relatedBookableIds           | An array of ids of bookables related to the current bookable.                                                                                                             |
| checkoutBookableIds          | An array of ids of bookables that can be checked out with the current bookable.                                                                                           |
| imgUrl                       | The URL of the cover image of the bookable.                                                                                                                               |
| isBookable                   | A boolean indicating if the bookable is bookable. If false, bookable cannot be checked out.                                                                               |
| isPublic                     | A boolean indicating if the bookable is public. If false, the bookable es excluded from public lists.                                                                     |
| permittedUsers               | An array of users who are permitted to book the bookable. If empty, every user incl. guests is allowed to book this bookable.                                             |
| permittedRoles               | An array of roles that are permitted to book the bookable. If empty, every user incl. guests is allowed to book this bookable.                                            |
| freeBookingUsers             | An array of users who can book the bookable for free.                                                                                                                     |
| freeBookingRoles             | An array of roles that can book the bookable for free.                                                                                                                    |
| isLongRange                  | A boolean indicating if the bookable is available for long range booking. If true, the users is requested to select a full week or month when checking out this bookable. |
| longRangeOptions             | e.g. week, month.                                                                                                                                                         |


### Booking

Reservations made by users for bookable resources.

Example:

```json
{
  "id": "BK-1234",
  "tenantId": "default",
  "assignedUserId": "user1",
  "timeBegin":  1707994800000,
  "timeEnd": 1708009200000,
  "timeCreated": 1707994800000,
  "bookableItems": [  ],
  "couponCode": "COUPON123",
  "name": "John Doe",
  "company": "Some Corp",
  "street": "123 Main St",
  "zipCode": "12345",
  "location": "Anytown",
  "mail": "john.doe@example.com",
  "phone": "1234567890",
  "comment": "Please provide a projector and whiteboard.",
  "priceEur": 100,
  "isCommitted": true,
  "isPayed": true,
  "_couponUsed": { }
}
```

A booking is a reservation of a bookable by a user (or guest). Bookings have a start and end date, a user and one or more related bookables. Bookings can have additional properties like a status, payment method, etc.

| Field          | Description                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| id             | The unique identifier of the booking.                                                                                                 |
| tenant         | The tenant to which the booking belongs.                                                                                              |
| assignedUserId | The ID of the user who made the booking.                                                                                              |
| timeBegin      | The start time of the booking.                                                                                                        |
| timeEnd        | The end time of the booking.                                                                                                          |
| timeCreated    | The time when the booking was created.                                                                                                |
| bookableItems  | An array of bookable items included in the booking. Each item includes the bookable ID, tenant, amount, and the used bookable object. |
| couponCode     | The coupon code applied to the booking.                                                                                               |
| name           | The name of the person who made the booking.                                                                                          |
| company        | The company of the person who made the booking.                                                                                       |
| street         | The street address of the person who made the booking.                                                                                |
| zipCode        | The zip code of the person who made the booking.                                                                                      |
| location       | The city or location of the person who made the booking.                                                                              |
| mail           | The email address of the person who made the booking.                                                                                 |
| phone          | The phone number of the person who made the booking.                                                                                  |
| comment        | Any comments or special requests made during the booking.                                                                             |
| priceEur       | The total price of the booking in Euros.                                                                                              |
| isCommitted    | A boolean indicating whether the booking is committed.                                                                                |
| isPayed        | A boolean indicating whether the booking is paid.                                                                                     |
| \_couponUsed   | The coupon used in the booking. It includes the ID, tenant, code, discount in Euros, and the valid from and to dates.                 |


### Coupon

Discount codes that can be applied to bookings.

Example:

```JSON
{
  "id": "STUDENT50",
  "tenantId": "default",
  "description": "50% discount for students",
  "type": "percentage",
  "discount": "50",
  "maxAmount": 20,
  "usedAmount": 3,
  "validFrom": 1677668400000,
  "validTo": 1735685940000,
  "ownerUserId": "some@example.com"
}
```

### Event

Events are not considered as bookables. Instead, they serve as a representation of real-world events, holding crucial information such as the event description, date and time, speakers, and more. This data is primarily used for display purposes on a website, providing users with detailed information about the event. Events can also be linked to tickets, allowing users to book their attendance for these events. However, the booking process is handled through the associated tickets, not the events themselves.

Example:

```JSON
{
  "id": "event-123",
  "tenantId": "default",
  "attachments": [ ],
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
    "contactPersonImage": null,
    "speakers": []
  },
  "format": 0,
  "images": [ ],
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
  "schedules": [
    [
      {
        "id": "",
        "date": "",
        "time": "",
        "description": "",
        "schedules": []
      },
      {
        "id": "",
        "date": "",
        "time": "",
        "description": "",
        "schedules": []
      }
    ]
  ]
}

```

| Field          | Description                                                                                  |
|----------------| -------------------------------------------------------------------------------------------- |
| id             | The unique identifier of the event                                                           |
| tenantId       | The tenant to which the event belongs.                                                       |
| attachments    | An array of attachments related to the event. Each attachment is a string.                   |
| attendees      | An object containing information about the attendees of the event.                           |
| eventAddress   | An object containing the address of the event.                                               |
| eventLocation  | An object containing the location of the event.                                              |
| eventOrganizer | An object containing information about the organizer of the event.                           |
| format         | The format of the event.                                                                     |
| images         | An array of images related to the event. Each image has an id, title, type, and url.         |
| information    | An object containing additional information about the event.                                 |
| isPublic       | A boolean indicating whether the event is public.                                            |
| schedules      | An array of schedules for the event. Each schedule has a start time, end time, and location. |


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
