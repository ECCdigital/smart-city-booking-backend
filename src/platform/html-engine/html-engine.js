const BookableManager = require("../../commons/data-managers/bookable-manager");
const TenantManager = require("../../commons/data-managers/tenant-manager");

class HtmlEngine {
  static translatePriceCategory(priceCategory) {
    if (priceCategory === "per-hour") {
      return "pro Stunde";
    } else if (priceCategory === "per-day") {
      return "pro Tag";
    }

    return "";
  }

  static generateImageHtml(imgUrl, className, altText) {
    return imgUrl ? `<img src="${imgUrl}" class="${className}"  alt="${altText}"/>` : "";
  }

  static async bookablesToList(bookables, order = []) {
    var htmlOutput = '<ul class="booking-manager-list">';

    if (order.length > 0) {
      bookables.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }

    for (const bookable of bookables) {
      const tenantObj = await TenantManager.getTenant(bookable.tenant);

      htmlOutput += '<li class="bt-' + bookable.type + '">';
      htmlOutput += this.generateImageHtml(bookable.imgUrl,'cover-image', bookable.title);
      htmlOutput += "<h4>" + (bookable.title || "") + "</h4>";
      htmlOutput +=
        '<p class="description">' + (bookable.description || "") + "</p>";
      htmlOutput +=
        bookable.location != null && bookable.location.length > 0
          ? '<p class="location">' + (bookable.location || "") + "</p>"
          : "";
      htmlOutput += '<p class="type">' + (bookable.type || "") + "</p>";

      if (bookable.flags && bookable.flags.length > 0) {
        htmlOutput += '<ul class="flags">';
        bookable.flags.forEach((flag) => {
          htmlOutput += '<li class="flag">' + flag + "</li>";
        });
        htmlOutput += "</ul>";
      }

      if (bookable.isBookable) {
        htmlOutput +=
          '<p class="autoCommitBooking">' +
          (bookable.autoCommitBooking === true
            ? "Direkt buchbar"
            : "Individuelle Freigabe erforderlich") +
          "</p>";

        htmlOutput += '<p class="price">';

        if (bookable.priceEur > 0) {
          htmlOutput += new Intl.NumberFormat("de-DE", {
            style: "currency",
            currency: "EUR",
          }).format(bookable.priceEur);
          htmlOutput +=
            ' <span class="prce-category">' +
            HtmlEngine.translatePriceCategory(bookable.priceCategory) +
            "</span>";
        } else {
          htmlOutput += "kostenlos";
        }

        htmlOutput += "</p>";

        let buttonText = bookable.autoCommitBooking
          ? "Jetzt buchen"
          : "Jetzt anfragen";
        htmlOutput +=
          '<a href="' +
          process.env.FRONTEND_URL +
          "/checkout?id=" +
          bookable.id +
          "&tenant=" +
          bookable.tenant +
          '" class="btn-booking" target="_blank">' +
          buttonText +
          "</a>";
      }

      htmlOutput += `<a class="btn-detail" href="${tenantObj.bookableDetailLink}?bkid=${bookable.id}">Details</a>`;

      htmlOutput += "</li>";
    }

    htmlOutput += "</ul>";

    return htmlOutput;
  }

  static async bookable(bookable) {
    let htmlOutput = '<div class="bookable-item">';

    htmlOutput += this.generateImageHtml(bookable.imgUrl, 'cover-image', bookable.title);
    htmlOutput += "<h3>" + (bookable.title || "") + "</h3>";
    htmlOutput +=
      '<p class="description">' + (bookable.description || "") + "</p>";

    if (bookable.flags && bookable.flags.length > 0) {
      htmlOutput += '<ul class="flags">';
      bookable.flags.forEach((flag) => {
        htmlOutput += '<li class="flag">' + flag + "</li>";
      });
      htmlOutput += "</ul>";
    }

    if (bookable.attachments.length > 0) {
      htmlOutput += '<ul class="attachments">';
      bookable.attachments
        .filter((attachment) => attachment.type !== "agreement")
        .forEach((attachment) => {
          htmlOutput += '<li class="attachment">';
          htmlOutput +=
            '<a href="' +
            attachment.url +
            '" target="_blank">' +
            attachment.title +
            "</a>";
          htmlOutput += "</li>";
        });
      htmlOutput += "</ul>";
    }

    if (bookable.isBookable) {
      htmlOutput +=
        bookable.location != null && bookable.location.length > 0
          ? '<p class="location">' + (bookable.location || "") + "</p>"
          : "";
      htmlOutput += '<p class="type">' + (bookable.type || "") + "</p>";
      htmlOutput +=
        '<p class="autoCommitBooking">' +
        (bookable.autoCommitBooking === true
          ? "Direkt buchbar"
          : "Individuelle Freigabe erforderlich") +
        "</p>";

      htmlOutput += '<p class="price">';

      if (bookable.priceEur > 0) {
        htmlOutput += new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: "EUR",
        }).format(bookable.priceEur);
        htmlOutput +=
          ' <span class="prce-category">' +
          HtmlEngine.translatePriceCategory(bookable.priceCategory) +
          "</span>";
      } else {
        htmlOutput += "kostenlos";
      }

      htmlOutput += "</p>";

      let buttonText = bookable.autoCommitBooking
        ? "Jetzt buchen"
        : "Jetzt anfragen";
      htmlOutput +=
        '<a href="' +
        process.env.FRONTEND_URL +
        "/checkout?id=" +
        bookable.id +
        "&tenant=" +
        bookable.tenant +
        '" class="btn-booking" target="_blank">' +
        buttonText +
        "</a>";
    }

    let relatedBookables = (
      await BookableManager.getRelatedBookables(bookable.id, bookable.tenant)
    ).filter((bookable) => bookable.isPublic === true);

    if (relatedBookables.length > 0) {
      htmlOutput += '<div class="related-bookable-objects">';
      htmlOutput += await HtmlEngine.bookablesToList(
        relatedBookables,
        bookable.relatedBookableIds,
      );
      htmlOutput += "</div>";
    }

    htmlOutput += "</div>";

    return htmlOutput;
  }

  static async eventsToList(events) {
    var htmlOutput = '<ul class="booking-manager-list">';

    for (const event of events) {
      const tenantObj = await TenantManager.getTenant(event.tenant);

      let tags = "";
      event.information.tags.forEach((tag) => {
        tags += tag + " ";
      });

      htmlOutput += `<li class="event" rel="${tags.trim()}">`;
      htmlOutput += this.generateImageHtml(event.information.teaserImage, 'cover-image', event.information.teaserImage.name);
      htmlOutput += "<h3>" + (event.information?.name || "") + "</h3>";

      if (!!event.information?.startDate && !!event.information?.endDate) {
        const startDate = Intl.DateTimeFormat("de-DE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(new Date(event.information.startDate));
        const endDate = Intl.DateTimeFormat("de-DE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(new Date(event.information.endDate));
        let dateString = `${startDate} ${event.information.startTime || ""} - ${
          startDate !== endDate ? endDate + " " : ""
        }${event.information.endTime || ""}`;

        htmlOutput += `<p class="date">${dateString}</p>`;
      }

      htmlOutput +=
        '<p class="organizer-name">' +
        (event.eventOrganizer?.name || "") +
        "</p>";
      htmlOutput +=
        '<p class="teaser-text">' +
        (event.information?.teaserText || "") +
        "</p>";

      htmlOutput += '<ul class="flags">';
      event.information.flags.forEach((flag) => {
        htmlOutput += '<li class="flag">' + flag + "</li>";
      });
      htmlOutput += "</ul>";

      if (event.attendees?.free === false) {
        htmlOutput += '<ul class="price-category-list">';
        htmlOutput += '<li class="price-category-item">';
        event.attendees.priceCategories.forEach((priceCategory) => {
          htmlOutput +=
            '<span class="price-category">' + priceCategory.name + "</span>";
          htmlOutput +=
            '<div class="price">' +
            new Intl.NumberFormat("de-DE", {
              style: "currency",
              currency: "EUR",
            }).format(priceCategory.price) +
            "</div>";
        });
        htmlOutput += "</li>";
        htmlOutput += "</ul>";
      } else {
        htmlOutput += '<p class="price-free">kostenlos</p>';
      }

      htmlOutput += `<a class="btn-detail" href="${tenantObj.eventDetailLink}?bkid=${event.id}">Details</a>`;

      htmlOutput += "</li>";
    }

    htmlOutput += "</ul>";

    return htmlOutput;
  }

  static async event(event, showAttachments) {
    var htmlOutput = `<div class="event">`;

    // INFORMATION
    htmlOutput += `<div class="information">`;
    htmlOutput += `<h1>Informationen</h1>`;
    htmlOutput += `<h2>${event.information.name || ""}</h2>`;
    htmlOutput += this.generateImageHtml(event.information.teaserImage, 'teaser-image', event.information.teaserImage.name);
    htmlOutput += `<div class="description">${
      event.information.description || ""
    }</div>`;

    let startDate = Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(event.information.startDate));
    let endDate = Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(event.information.endDate));
    let dateString = `${startDate} ${event.information.startTime || ""} - ${
      startDate !== endDate ? endDate + " " : ""
    }${event.information.endTime || ""}`;

    htmlOutput += `<div class="date">${dateString}</div>`;

    // FLAGS
    if (event.information.flags.length > 0) {
      htmlOutput += `<ul class="flags">`;
      event.information.flags.forEach((flag) => {
        htmlOutput += `<li class="flag">${flag}</li>`;
      });
      htmlOutput += `</ul>`;
      htmlOutput += `</div>`;
    }

    // EVENT LOCATION
    htmlOutput += `<div class="event-location">`;
    htmlOutput += `<h5>Veranstaltungsort</h5>`;

    htmlOutput += event.eventLocation.name
      ? `<div class="name">${event.eventLocation.name || ""}</div>`
      : "";
    htmlOutput += event.eventLocation.street
      ? `<div class="street">${event.eventAddress.street || ""}</div>`
      : "";
    htmlOutput += event.eventLocation.zip
      ? `<div class="zip">${event.eventAddress.zip || ""}</div>`
      : "";
    htmlOutput += event.eventLocation.city
      ? `<div class="city">${event.eventAddress.city || ""}</div>`
      : "";
    htmlOutput += event.eventLocation.phoneNumber
      ? `<div class="phone-number">${
          event.eventLocation.phoneNumber || ""
        }</div>`
      : "";
    htmlOutput += event.eventLocation.emailAddress
      ? `<div class="email-address">${
          event.eventLocation.emailAddress || ""
        }</div>`
      : "";
    if (event.eventLocation.room) {
      var eventLocationBookable = await BookableManager.getBookable(
        event.eventLocation.room,
        event.tenant,
      );
      htmlOutput += `<div class="room">${eventLocationBookable.title}</div>`;
    }
    htmlOutput += event.eventLocation.additional
      ? `<div class="additional">${event.eventAddress.additional || ""}</div>`
      : "";

    htmlOutput += `</div>`;

    // EVENT ORGANIZER
    htmlOutput += `<div class="event-organizer">`;
    htmlOutput += `<h5>Veranstalter</h5>`;

    htmlOutput += `<div class="name">${event.eventOrganizer.name || ""}</div>`;

    if (event.eventOrganzier) {
      htmlOutput += this.generateImageHtml(event.eventOrganizer.contactPersonImage, 'contact-person-image', event.eventOrganizer.contactPersonName);
      htmlOutput += `<div class="contact-person-name">${
        event.eventOrganizer.contactPersonName || ""
      }</div>`;
      htmlOutput += `<div class="contact-person-phone-number">${
        event.eventOrganizer.contactPersonPhoneNumber || ""
      }</div>`;
      htmlOutput += `<div class="contact-person-phone-email-address">${
        event.eventOrganizer.contactPersonEmailAddress || ""
      }</div>`;
    }

    if (event.eventOrganizer.speakers.length > 0) {
      htmlOutput += `<h6>Referenten</h6>`;
      htmlOutput += `<ul class="speaker-list">`;

      event.eventOrganizer.speakers.forEach((speaker) => {
        htmlOutput += `<li class="speaker">`;
        htmlOutput += speaker.name
          ? `<div class="speaker-name">${speaker.name || ""}</div>`
          : "";
        htmlOutput += this.generateImageHtml(speaker.image, 'speaker-image', speaker.name);
        htmlOutput += speaker.phoneNumber
          ? `<div class="speaker-phone-number">${
              speaker.phoneNumber || ""
            }</div>`
          : "";
        htmlOutput += speaker.emailAddress
          ? `<div class="speaker-email-address">${
              speaker.emailAddress || ""
            }</div>`
          : "";
        htmlOutput += `</li>`;
      });

      htmlOutput += `</ul>`;
    }

    htmlOutput += `</div>`;

    // SCHEDULES
    htmlOutput += `<div class="schedules">`;
    htmlOutput += `<h5>Agenda</h5>`;

    htmlOutput += '<ul class="schedule-list">';

    event.schedules.forEach((schedule) => {
      htmlOutput += '<li class="schedule-item">';

      htmlOutput += `<div class="schedule-date">${Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(schedule.date))} ${schedule.time || ""}&nbsp;</div>`;
      htmlOutput += `<div class="schedule-description">${
        schedule.description || ""
      }</div>`;

      if (schedule.schedules && schedule.schedules.length > 0) {
        htmlOutput += '<ul class="sub-schedule-list">';
        schedule.schedules.forEach((subSchedule) => {
          htmlOutput += '<li class="sub-schedule-item">';
          htmlOutput += `<div class="sub-schedule-date">${
            subSchedule.time || ""
          }</div>`;
          htmlOutput += `<div class="sub-schedule-description">${
            subSchedule.description || ""
          }</div>`;
          htmlOutput += "</li>";
        });
        htmlOutput += "</ul>";
      }
      htmlOutput += "</li>";
    });

    htmlOutput += "</ul>";

    htmlOutput += `</div>`;

    //EVENT IMAGES
    if (event.images && event.images.length > 0) {
      htmlOutput += `<div class="event-images">`;
      htmlOutput += `<h5>Bilder</h5>`;
      htmlOutput += '<ul class="event-images-list">';
      event.images.forEach((image) => {
        htmlOutput += '<li class="event-image">';
        htmlOutput += this.generateImageHtml(image, 'event-image', image.name);
        htmlOutput += "</li>";
      });
      htmlOutput += "</ul>";
      htmlOutput += `</div>`;
    }

    // EVENT ATTACHMENTS
    if (showAttachments === true) {
      if (event.attachments && event.attachments.length > 0) {
        htmlOutput += `<div class="event-attachments">`;
        htmlOutput += `<h5>Anhänge</h5>`;
        htmlOutput += '<ul class="event-attachment-list">';
        event.attachments.forEach((eventAttachment) => {
          htmlOutput += '<li class="event-attachment">';
          htmlOutput += `<a href="${eventAttachment}" target="_blank">${eventAttachment}</a>`;
          htmlOutput += "</li>";
        });
        htmlOutput += "</ul>";
        htmlOutput += `</div>`;
      }
    }

    let relatedTickets = (
      await BookableManager.getBookables(event.tenant)
    ).filter(
      (bookable) =>
        bookable.type === "ticket" &&
        bookable.eventId === event.id &&
        bookable.isPublic === true,
    );

    if (relatedTickets.length > 0) {
      htmlOutput += '<div class="related-tickets">';
      htmlOutput += await HtmlEngine.bookablesToList(relatedTickets);
      htmlOutput += "</div>";
    }

    htmlOutput += "</div>";

    // END
    htmlOutput += `</div>`;

    return htmlOutput;
  }
}

module.exports = HtmlEngine;
