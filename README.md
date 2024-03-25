# Smart City Booking (Backend)
![Node.js](https://img.shields.io/badge/Node.js-blue)
![npm](https://img.shields.io/badge/npm-blue)
![Docker](https://img.shields.io/badge/Docker-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-blue)

The "smart-city-booking" booking platform is an open-source software system with a focus on Smart Cities and Smart Regions. It offers an efficient solution that allows citizens, organizations, and companies to book and manage resources provided by public administrations. This platform provides a variety of configuration options to ensure flexible adaptation to individual needs.

This repository contains the backend of the application. The frontend is managed at https://github.com/ECCdigital/scanbunny-vue-app/smart-city-booking-vue-app.git

## Getting Started
This section will guide you through the process of setting up the Smart City Booking backend on your local machine for development and testing purposes.

### Prerequisites
Ensure that you have the following installed on your system:
- [Node.js](https://nodejs.org/) (v14.17.0 or higher)
- [npm](https://www.npmjs.com/) (v6.14.13 or higher)
- [MongoDB](https://www.mongodb.com/) (v4.4 or higher)



### Installation
1. Clone the repository
```bash
git clone https://github.com/ECCdigital/smart-city-booking-backend.git
```

2. Navigate to the project directory
```bash
cd smart-city-booking-backend
```

3. Install dependencies
```bash
npm install
```

4. Copy the `.env.example` file to `.env` to get a basic configuration setup. You can modify the values in the `.env` file to suit your environment.


5. Adjust database configuration in the `.env` file, e.g.:
```bash
DB_HOST=localhost
DB_PORT=27017
DB_NAME=smart-city-booking
```

6. Start the application in development mode. (Make sure the database instance configured above is running and setup as described below )
```bash
npm run dev
```

### Database Setup
In order to run the backend, you need a MongoDB instance to which you can connect. This instance can be a local or remote MongoDB server. You can also use a MongoDB instance running in a Docker container.

In order to start the application, connect to your database and create a new database with the name specified in the `.env` file. The database name is specified in the `DB_NAME` variable.

In order to login to your application create initial tenant, roles and user objects in the database.

```bash
db.tenants.insertOne({
  "id": "default",
  "name": "Default Tenant"
});
```

```bash
db.roles.insertOne({
  "id": "super-admin",
  "name": "Super Admin",
  "ownerTenant": "default",
  "adminInterfaces": [
    "locations", "tenants", "users", "roles", "bookings", 
    "coupons", "rooms", "resources", "tickets", "events"
  ],
  "manageUsers": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageTenants": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageBookables": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageRoles": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageCoupons": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageBookings": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  }
});
```

```bash 
db.users.insertOne({
  "id": "someone@example.com",
  "tenant": "default",
  "secret": "sha1$2327e3d2$1$6fdbf02ce5168a4215bcb1ae5553056503d02e40",
  "isVerified": true,
  "roles": ["super-admin"]
});
```

After setting up the database, you can login to the application with the following credentials:
- Email: someone@example.com
- Password: password

## Authentication
The backend of this application employs a local strategy for user authentication. This means that it verifies user credentials (username and password) against the user records stored in the database. Once a user is successfully authenticated, a session cookie is generated and stored on the user's device. This cookie is then used to maintain the user's authenticated state across multiple requests, providing a seamless user experience.

Use the following routes to authenticate users:

### POST /auth/:tenant/signin
Signs in a user with the specified credentials.

Input:
- tenant: The tenant ID

Body: 
```JSON
{
    "id": "<someone@example.com>",
    "password": "<your-password>"
}
```

### GET /auth/:tenant/signout
Signs out the currently authenticated user.

Input:
- tenant: The tenant ID

### POST /auth/:tenant/signup
Signs up a new user with the specified credentials.

Input:
- tenant: The tenant ID

Body: 
```JSON
{
    "id": "<someone@example.com>",
    "password": "<your-password>",
    "firstName": "<First Name>",
    "lastName": "<Last Name>"
}
```

### GET /auth/:tenant/verify/:hookId
Verifies a user with the specified hook ID. A hook ID is generated when a user signs up.

Input:
- tenant: The tenant ID
- hookId: The hook ID

### GET /auth/:tenant/reset/:hookId
Resets the password of a user specified in the hook with the given ID. A hook is generated when a user requests a password reset.

Input:
- tenant: The tenant ID
- hookId: The hook ID

### POST /auth/:tenant/resetpassword
Resets the password of a user with the specified credentials. The requested password is stored in a hook and changed after the user releases the hook.

Input:
- tenant: The tenant ID

Body: 
```JSON
{
    "id": "<someone@example.com>",
    "password": "<new-password>"
}
```

### GET /auth/:tenant/me
Returns the currently authenticated user.
    

## API 
If the Backend is running, you can access the API with the following routes:

### Public and Protected Routes
The API has two types of routes: public and protected. Public routes can be accessed without authentication, while protected routes require a valid session authentication to be available.

### Tenants

---  

### GET /api/tenants (Public / Protected)
Returns a list of all tenants. If accessed without authentication, only public tenant information will be provided.

### GET /api/tenants/:id (Public / Protected)
Returns the tenant with the specified ID. If accessed without authentication, only public tenant information will be provided.

Input:
- id: The ID of the tenant

### PUT /api/tenants (Protected)
Updates or creates the tenant.

**Required permission:** tenant.allowCreate / tenant.allowUpdate

Body: A valid tenant object

### DELETE /api/tenants/:id (Protected)
Deletes the tenant with the specified ID.

**Required permission:** tenant.allowDelete

### Roles

---

### GET /api/roles (Protected)
Returns a list of all roles.

**Required permission:** role.allowRead

### GET /api/roles/:id (Protected)
Returns the role with the specified ID.

Input:
- id: The ID of the role

**Required permission:** role.allowRead

### PUT /api/roles (Protected)
Updates or creates the role.

**Required permission:** role.allowCreate / role.allowUpdate

### DELETE /api/roles/:id (Protected)
Deletes the role with the specified ID.

Input:
- id: The ID of the role

**Required permission:** role.allowDelete

### Bookables

---

### GET /api/:tenant/bookables (Public)
Returns a list of all bookables for the specified tenant.

Input:
- tenant: The tenant ID

### GET /api/:tenant/bookables/:id (Public)
Returns the bookable with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the bookable

### GET /api/:tenant/bookables/:id/bookings (Public)
Returns a list of all bookings for the specified bookable.

Input:
- tenant: The tenant ID
- id: The ID of the bookable
- related: If true, the bookings of related bookables are included in the response. (Query parameter)
- parent: If true, the bookings of the parent bookables are included in the response. (Query parameter)

### GET /api/:tenant/bookables/:id/openingHours (Public)
Returns the opening hours of the specified bookable.

Input:
- tenant: The tenant ID
- id: The ID of the bookable

### PUT /api/:tenant/bookables (Protected)
Updates or creates the bookable.

Input:
- tenant: The tenant ID

**Required permission:** bookable.allowCreate / bookable.allowUpdate

Body: A valid bookable object

### DELETE /api/:tenant/bookables/:id (Protected)
Deletes the bookable with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the bookable

**Required permission:** bookable.allowDelete

### GET /api/:tenant/bookables/_meta/_tags (Protected)
Returns a list of all tags used in the bookables of the specified tenant.

Input:
- tenant: The tenant ID

### Events

---

### GET /api/:tenant/events (Public)
Returns a list of all events for the specified tenant.

Input:
- tenant: The tenant ID

### GET /api/:tenant/events/:id (Public)
Returns the event with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the event

### GET /api/:tenant/events/:id/bookings (Public)
Returns a list of all bookings for the specified event.

Input:
- tenant: The tenant ID
- id: The ID of the event

### PUT /api/:tenant/events (Protected)
Updates or creates the event.

Input:
- tenant: The tenant ID

**Required permission:** event.allowCreate / event.allowUpdate

Body: A valid event object

### DELETE /api/:tenant/events/:id (Protected)
Deletes the event with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the event

**Required permission:** event.allowDelete

### GET /api/:tenant/events/_meta/_tags (Protected)
Returns a list of all tags used in the events of the specified tenant.

Input:
- tenant: The tenant ID

### Users

---

### GET /api/:tenant/users (Protected)
Returns a list of all users for the specified tenant.

Input:
- tenant: The tenant ID

**Required permission:** user.allowRead

### GET /api/:tenant/users/ids (Protected)
Returns a list of all user IDs for the specified tenant.

Input:
- tenant: The tenant ID
- roles: If provided, only user IDs with the specified roles are included in the response. (Query parameter)

### GET /api/:tenant/users/:id (Protected)
Returns the user with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the user

**Required permission:** user.allowRead

### PUT /api/:tenant/users (Protected)
Updates or creates the user.

Input:
- tenant: The tenant ID

**Required permission:** user.allowCreate / user.allowUpdate

Body: A valid user object

### PUT /api/:tenant/user (Protected)
Updates the user object of the currently authenticated user.

Input:
- tenant: The tenant ID

Body: A valid user object

### DELETE /api/:tenant/users/:id (Protected)
Deletes the user with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the user

**Required permission:** user.allowDelete

### Bookings

---

### GET /api/:tenant/bookings (public)
Returns a list of all bookings for the specified tenant.

Input:
- tenant: The tenant ID
- public: If true, only public bookings are included in the response. (Query parameter)
- user: If provided, only bookings of the specified user are included in the response. (Optional)
  - populate: If true, the user object is included in the response. (Query parameter)

**Required permission:** booking.allowRead (If public is false)

### GET /api/:tenant/bookings/:id/status (public)
Returns the status of the booking with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the booking

### GET /api/:tenant/bookings/:id (Protected)
Returns the booking with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the booking

**Required permission:** booking.allowRead / Owner of the booking


### GET /api/:tenant/bookings (Protected)
Returns a list of all bookings for the specified tenant.

Input:
- tenant: The tenant ID

**Required permission:** booking.allowRead / Owner of the booking

### PUT /api/:tenant/bookings (Protected)
Updates or creates the booking.

Input:
- tenant: The tenant ID

**Required permission:** booking.allowCreate / booking.allowUpdate

Body: A valid booking object

### GET /api/:tenant/mybookings (Protected)
Returns a list of all bookings of the currently authenticated user.

Input:
- tenant: The tenant ID

### DELETE /api/:tenant/bookings/:id (Protected)
Deletes the booking with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the booking

**Required permission:** booking.allowDelete


### GET /api/:tenant/bookings/:id/commit (Protected)
Commits the booking with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the booking

**Required permission:** booking.allowUpdate

### Coupons

---

### GET /api/:tenant/coupons (Public)
Returns a list of all coupons for the specified tenant.

Input:
- tenant: The tenant ID

**Required permission:** coupon.allowRead

### GET /api/:tenant/coupons/:id (Public)
Returns the coupon with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the coupon

### PUT /api/:tenant/coupons (Protected)
Updates or creates the coupon.

Input:
- tenant: The tenant ID

**Required permission:** coupon.allowCreate / coupon.allowUpdate

Body: A valid coupon object

### DELETE /api/:tenant/coupons/:id (Protected)
Deletes the coupon with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the coupon

**Required permission:** coupon.allowDelete

### Checkout

---

### POST /api/:tenant/checkout (Public)
Creates a new booking and returns the booking object.

Input:
- tenant: The tenant ID

Body: A valid booking object

### POST /api/:tenant/checkout/validateItem (Public)
Validates a bookable item for checkout.

Input:
- tenant: The tenant ID

Body: {
    "bookableId": "<bookable-id>",
    "timeBegin": "<start-time>",
    "timeEnd": "<end-time>",
    "amount": "<amount>"
    "couponCode": "<coupon-code>"
    }

### Payments / S-Public-Services

---

### POST /api/:tenant/payments (Public)
Returns a payment URL for the specified booking.

Input:
- tenant: The tenant ID

Body: bookingId

### GET /api/:tenant/payments/notify (Public)
Notifies the backend about a payment status.

Input:
- tenant: The tenant ID
- gcMerchantTxId: The merchant transaction ID (Query parameter)
- gcResultPayment: The payment result (Query parameter)
- gcPaymethod: The payment method (Query parameter)
- gcType: The payment type (Query parameter)
- gcProjectId: The project ID (Query parameter)
- gcReference: The payment reference (Query parameter)
- gcBackendTxId: The backend transaction ID (Query parameter)
- gcAmount: The payment amount (Query parameter)
- gcCurrency: The payment currency (Query parameter)
- gcHash: The payment hash (Query parameter)

### POST /api/:tenant/payments/response (Public)
Redirects the user to the payment response page.

Input:
- tenant: The tenant ID
- parsedOriginalUrl: The original URL (Body)

### Calendars

---

### GET /api/:tenant/occupancy (Public)
Returns the occupancy of a tenant or if provided of a bookable.

Input:
- tenant: The tenant ID
- ids: A comma-separated list of bookable IDs (Query parameter)

### Files (Nextcloud)

---

### GET /api/:tenant/files/list (Public / Protected)
Returns a list of all files in the Nextcloud storage.

Input:
- tenant: The tenant ID
- includeProtected: If true, protected files are included in the response. (Query parameter)


### GET /api/:tenant/files/get (Public / Protected)
Returns the file with the specified ID.

Input:
- tenant: The tenant ID
- id: The ID of the file

### POST /api/:tenant/files (Protected)
Uploads a file to the Nextcloud storage.

Input:
- tenant: The tenant ID
- file: The file to upload

Body: {
    "accessLevel": "public" / "protected"
    "customDirectory": "directory"
    }


## Entitites
The Smart City Booking backend manages the following entities:

### Tenants
A tenant is a group of users that share common access with specific privileges to the software instance. A tenant can have multiple users, resources. Each tenant has its own configuration and data.

Example:
```JSON
{
  "id": "default",
  "name": "Example Name",
  "contactName": "Example Contact",
  "location": "Example Location",
  "mail": "example@example.com",
  "phone": "1234567890",
  "noreplyHost": "smtp.example.com",
  "noreplyMail": "noreply@example.com",
  "noreplyDisplayName": "Example Display Name",
  "noreplyPort": "465",
  "noreplyPassword": { },
  "paymentMerchantId": { },
  "paymentProjectId": { },
  "genericMailTemplate": "<html>...</html>",
  "receiptTemplate": "<html>...</html>",
  "receiptNumberPrefix": "exmp",
  "paymentSecret": { },
  "paymentPurposeSuffix": "Example 123 4 56",
  "noreplyUser": "smtp_user",
  "bookableDetailLink": "https://www.example.com/bookable-detail",
  "eventDetailLink": "https://www.example.com/event-detail",
  "ownerUserId": "example@example.com",
  "receiptCount": {
    "2024": 1
  },
  "website": "https://example.com"
}
```

Sensitive data like 

- noreplyPassword
- paymentMerchantId
- paymentProjectId
- paymentSecret

is stored encrypted. 

### Roles
A role is a set of permissions that can be assigned to users. Each role has a set of permissions that define what actions a user with that role can perform. Roles are shared across tenants of the same instance.

Example:
```JSON
{
  "id": "super-admin",
  "name": "Super Admin",
  "ownerTenant": "default",
  "adminInterfaces": [
    "locations", "tenants", "users", "roles", "bookings", 
    "coupons", "rooms", "resources", "tickets", "events"
  ],
  "manageUsers": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageTenants": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageBookables": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageRoles": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageCoupons": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  },
  "manageBookings": {
    "create": true, "readAny": true, "readOwn": true, "updateAny": true,
    "updateOwn": true, "deleteOwn": true, "deleteAny": true
  }
}
```

### User
A user is an individual who can access the software instance. Users can be assigned roles that define what actions they can perform. Users are associated with a tenant.

Example:
```JSON
{
  "id": "someone@example.com",
  "secret": "encrypted-password",
  "tenant": "default",
  "hooks": [],
  "isVerified": true,
  "created": 1658991377408,
  "roles": [
    "super-admin"
  ]
}
```

### Bookable
A bookable is a resource that can be booked by users. Bookables can be rooms, resources, tickets or any other bookable object. Each bookable has a set of properties that define its pricing, availability and booking rules.

Bookables can can have relations to other bookables, e.g. a room can have a relation to a building. Those relations are important for the booking process.

Here is a table that describes the fields in the bookable object:

| Field | Description                                                                                                                                                               |
| --- |---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| id | The unique identifier of the bookable.                                                                                                                                    |
| tenant | The tenant to which the bookable belongs.                                                                                                                                 |
| type | The type of the bookable (e.g., room, event location, resource, ticket).                                                                                                  |
| title | The title or name of the bookable.                                                                                                                                        |
| description | A description of the bookable.                                                                                                                                            |
| location | The location of the bookable.                                                                                                                                             |
| priceEur | The price of the bookable in Euros.                                                                                                                                       |
| priceCategory | The category of the price (e.g. per-hour, per-item, per-day).                                                                                                             |
| amount | The available amount of the bookable. Unlimited if undefined.                                                                                                             |
| isScheduleRelated | A boolean indicating if the bookable is related to a schedule. If true, the user is promted to choose a booking time in the checkout.                                     |
| isTimePeriodRelated | A boolean indicating if the bookable is related to a time period. If true, the user is prompted to select one of the predefined time periods.                             |
| timePeriods | An array of repeating time periods within a week during which the bookable is available. Each time period has weekdays, a start time, and an end time.                    |
| minBookingDuration | The minimum booking duration for the bookable.                                                                                                                            |
| maxBookingDuration | The maximum booking duration for the bookable.                                                                                                                            |
| autoCommitBooking | A boolean indicating if the booking is automatically committed respecively the user is automatically directed into payment.                                               |
| attachments | An array of attachments related to the bookable. Each attachment has an id, title, type, and url.                                                                         |
| isOpeningHoursRelated | A boolean indicating if the bookable is dependent to opening hours.                                                                                                       |
| openingHours | An array of opening hours for the bookable. Each opening hour has weekdays, a start time, and an end time.                                                                |
| isSpecialOpeningHoursRelated | A boolean indicating if the bookable has special opening hours.                                                                                                           |
| specialOpeningHours | An array of special opening hours for the bookable. Each special opening hour has a date, start time, and end time.                                                       |
| tags | An array of tags associated with the bookable. Used for internal clustering.                                                                                              |
| flags | An array of flags associated with the bookable. Used to present important features of this bookable to the user.                                                          |
| eventId | The id of the event associated with the bookable. (Only for type = ticket)                                                                                                |
| relatedBookableIds | An array of ids of bookables related to the current bookable.                                                                                                             |
| checkoutBookableIds | An array of ids of bookables that can be checked out with the current bookable.                                                                                           |
| imgUrl | The URL of the cover image of the bookable.                                                                                                                               |
| isBookable | A boolean indicating if the bookable is bookable. If false, bookable cannot be checked out.                                                                               |
| isPublic | A boolean indicating if the bookable is public. If false, the bookable es excluded from public lists.                                                                     |
| permittedUsers | An array of users who are permitted to book the bookable.  If empty, every user incl. guests is allowed to book this bookable.                                            |
| permittedRoles | An array of roles that are permitted to book the bookable. If empty, every user incl. guests is allowed to book this bookable.                                            |
| freeBookingUsers | An array of users who can book the bookable for free.                                                                                                                     |
| freeBookingRoles | An array of roles that can book the bookable for free.                                                                                                                    |
| isLongRange | A boolean indicating if the bookable is available for long range booking. If true, the users is requested to select a full week or month when checking out this bookable. |
| longRangeOptions | e.g. week, month.                                                                                                                                                         |


Example:
```json
{
  "id": "room-123",
  "tenant": "default",
  "type": "room",
  "title": "Conference Room",
  "description": "A large conference room with a capacity of 50 people.",
  "location": "First Floor",
  "priceEur": "100",
  "priceCategory": "per-hour",
  "amount": 1,
  "isScheduleRelated": true,
  "isTimePeriodRelated": false,
  "minBookingDuration": 1,
  "maxBookingDuration": 4,
  "autoCommitBooking": true,
  "attachments": [
    {
      "id": "1",
      "title": "User manual",
      "type": "user-manual",
      "url": "https://.../manuel.pdf"
    }
  ],
  "timePeriods": [ {
    "weekdays": [
      1, 2, 3
    ],
    "startTime": "10:00",
    "endTime": "15:00"
  }],
  "isOpeningHoursRelated": true,
  "openingHours": [{
      "weekdays": [
        1, 2, 3
      ],
      "startTime": "08:00",
      "endTime": "18:00"
    }],
  "isSpecialOpeningHoursRelated": false,
  "specialOpeningHours": [{
    "date": "2023-12-06",
    "startTime": "00:00",
    "endTime": "00:00"
  }],
  "tags": ["conference", "large"],
  "flags": ["projector", "whiteboard"],
  "eventId": "event1",
  "relatedBookableIds": ["bkbl-1", "bkbl-3"],
  "checkoutBookableIds": ["bkbl-2", "bkbl-4"],
  "imgUrl": "https://example.com/image.png",
  "isBookable": true,
  "isPublic": true,
  "permittedUsers": ["user1", "user2"],
  "permittedRoles": ["role1", "role2"],
  "freeBookingUsers": ["user3"],
  "freeBookingRoles": ["role3"],
  "isLongRange": false,
  "longRangeOptions": {
    "type": "month"
  }
}
```

Please note that this is a simplified example and the actual structure of your bookable object may vary.

### Booking
A booking is a reservation of a bookable by a user (or guest). Bookings have a start and end date, a user and one or more related bookables. Bookings can have additional properties like a status, payment method, etc.

| Field | Description |
| --- | --- |
| id | The unique identifier of the booking. |
| tenant | The tenant to which the booking belongs. |
| assignedUserId | The ID of the user who made the booking. |
| timeBegin | The start time of the booking. |
| timeEnd | The end time of the booking. |
| timeCreated | The time when the booking was created. |
| bookableItems | An array of bookable items included in the booking. Each item includes the bookable ID, tenant, amount, and the used bookable object. |
| couponCode | The coupon code applied to the booking. |
| name | The name of the person who made the booking. |
| company | The company of the person who made the booking. |
| street | The street address of the person who made the booking. |
| zipCode | The zip code of the person who made the booking. |
| location | The city or location of the person who made the booking. |
| mail | The email address of the person who made the booking. |
| phone | The phone number of the person who made the booking. |
| comment | Any comments or special requests made during the booking. |
| priceEur | The total price of the booking in Euros. |
| isCommitted | A boolean indicating whether the booking is committed. |
| isPayed | A boolean indicating whether the booking is paid. |
| _couponUsed | The coupon used in the booking. It includes the ID, tenant, code, discount in Euros, and the valid from and to dates. |

Example:
```JSON
{
  "id": "BK-1234",
  "tenant": "default",
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

### Coupon
A coupon is a discount code that can be applied to a booking. Coupons have a code, a discount value and a validity period.

Example:
```JSON
{
  "id": "STUDENT50",
  "tenant": "default",
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

// TODO: Add example


## Integrate data into a website
The Smart City Booking backend provides a Web Interface that can be used to integrate bookables, events and additional information into a website or HTML based application. 

In order to integrate the data into a website, you can use the JavaScript SDK provided by the backend. The SDK provides methods to fetch bookables, events, and other data from the backend and display it on your website.

When integrating the SDK into your website, data is loaded asynchroniously from the backend when your website is loaded. The SDK provides a set of row HTML tags that are dynamically loaded into your website. You can style those web components with CSS to match your website's design.

### Setup Web Interface
To use the SDK, you need to include the following script in your HTML file:

```html
<script src="https://demo1.smart-city-booking.de/cdn/current/booking-manager.min.js"></script>
<script>
    const bm = new BookingManager();
    bm.url = 'https://demo1.smart-city-booking.de';
    bm.tenant = 'default';
    window.addEventListener('load', () => {
      bm.init();
    });
</script>
```

### Bookable List

To display a list of bookables on your website, you can use the following code:

```html
<div id="bm-bookable-list" data-type="room" data-ids="bklbl-123,bkbl-345"></div>
```

| Parameter            | Description                                                                                                                               |
|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| data-type (optional) | The type of bookables to display in the list. For example, "room" to display only rooms. If not provided all bookables will be displayed. |
| data-ids (optional)  | A comma-separated list of bookable IDs to display in the list. If not provided, all bookables of the specified type will be displayed.    |

### Bookable Item
Display a single bookable item on your website:

```html
<div id="bm-bookable-item" data-id="bklbl-123" data-id-param="bkm_id"></div>
```

| Parameter | Description |
| --- | --- |
| data-id | The ID of the bookable item to display. |
| data-id-param | The name of the URL parameter that contains the bookable ID. If this parameter is provided, the bookable ID will be read from the URL instead of the `data-id` attribute. |

### Event List
Display a list of events on your website:

```html
<div id="bm-event-list" data-ids="evt-123,evt-234"></div>
```

| Parameter | Description |
| --- | --- |
| data-ids | A comma-separated list of event IDs to display in the list. If not provided, all events will be displayed. |

### Event Item
Display a single event item on your website:

```html
<div id="bm-event-item" data-id="evt-123" data-id-param="evt_id"></div>
```

| Parameter | Description |
| --- | --- |
| data-id | The ID of the event item to display. |
| data-id-param | The name of the URL parameter that contains the event ID. If this parameter is provided, the event ID will be read from the URL instead of the `data-id` attribute. |

### Event Calendar
Display an event calendar on your website:

```html
<div class="bm-calendar" data-view="dayGridMonth"></div>
```

| Parameter | Description                                  |
| --- |----------------------------------------------|
| data-view | Defines the apperance of the calendar, e.g. 'dayGridWeek', 'timeGridDay', 'listWeek' . |


### Occupancy Calendar
Display an occupancy calendar on your website:

```html
<div class="bm-occupancy-calendar" data-view="dayGridMonth"></div>
```

| Parameter | Description                                  |
| --- |----------------------------------------------|
| data-view | Defines the apperance of the calendar, e.g. 'dayGridWeek', 'timeGridDay', 'listWeek' . |

### Login Form
Display a login form on your website:

```html
<div id="bm-login-form" data-success-redirect-url="https://..." data-error-redirect-url="https://...">
    <input type="email" name="username" placeholder="Email">
    <input type="password" name="password" placeholder="Password">
    <button id="bm-submit-signin">Login</button>
</div>
```

| Parameter | Description |
| --- | --- |
| data-success-redirect-url | The URL to redirect to after a successful login. |
| data-error-redirect-url | The URL to redirect to after a failed login. |

### Logout Button
Display a logout button on your website:

```html
<button id="bm-logout-button"></button>
```

### User Bookings Table (Protected)
Display a table of the user's bookings on your website. In order to display the user's bookings, the user must be authenticated.

```html
<div id="bm-user-bookings-table"></div>
```

### User Profile Form (Protected)
Display a form to edit the user's profile on your website. In order to display the user's profile, the user must be authenticated.

```html
<form id="bm-user-profile">
  <label for="firstname">First Name:</label><br>
  <input type="text" id="firstname" name="firstname"><br>
  <label for="lastname">Last Name:</label><br>
  <input type="text" id="lastname" name="lastname"><br>
  <label for="email">Email:</label><br>
  <input type="email" id="email" name="email"><br>
  <label for="phone">Phone:</label><br>
  <input type="tel" id="phone" name="phone"><br>
  <label for="address">Address:</label><br>
  <input type="text" id="address" name="address"><br>
  <label for="zip">ZIP Code:</label><br>
  <input type="text" id="zip" name="zip"><br>
  <label for="city">City:</label><br>
  <input type="text" id="city" name="city"><br>
  <button id="bm-submit-profile" value="Save" />
</form>
```