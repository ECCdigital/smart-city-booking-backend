const {
  BookableManager,
} = require("../../commons/data-managers/bookable-manager");
const TenantManager = require("../../commons/data-managers/tenant-manager");
const ExternalPriceService = require("../../commons/services/external-price-service");
const InstanceManager = require("../../commons/data-managers/instance-manager");
const {
  absoluteUrl,
  enrichAttachment,
} = require("../../commons/services/media/media-reference");

class HtmlEngine {
  /**
   * Resolves external price categories for bookables in-place.
   * @param {Object[]} bookables
   * @param {string} tenantId
   * @param {Map} [sharedCache]
   */
  static async _resolveExternalPrices(bookables, tenantId, sharedCache) {
    const cache = sharedCache || new Map();
    for (const bookable of bookables) {
      const extPrices = await ExternalPriceService.resolve(
        bookable,
        tenantId,
        cache,
      );

      if (extPrices) {
        bookable.priceCategories = extPrices;
      }
    }
  }

  static async _checkoutUrl(bookableId, tenantId, instance) {
    const checkoutInstance = instance || (await InstanceManager.getInstance());
    if (
      checkoutInstance &&
      !checkoutInstance.checkout.useLegacyCheckout &&
      checkoutInstance.checkout.checkoutUrl
    ) {
      return `${checkoutInstance.checkout.checkoutUrl}/checkout/${bookableId}/?tenantId=${tenantId}`;
    } else {
      return `${process.env.FRONTEND_URL}/checkout/?id=${bookableId}&tenant=${tenantId}`;
    }
  }

  static translatePriceTyp(priceCategory, short = false) {
    let translation = "";
    if (priceCategory === "per-hour") {
      translation = "Stunde";
    } else if (priceCategory === "per-day") {
      translation = "Tag";
    } else if (priceCategory === "per-item") {
      translation = "Stück";
    } else if (priceCategory === "per-quare-meter") {
      translation = "m²";
    }

    return short ? translation : "/" + translation;
  }

  static translateExternalUnit(unit) {
    const map = {
      hour: "/Stunde",
      day: "/Tag",
      week: "/Woche",
      month: "/Monat",
      year: "/Jahr",
      "service-fee": " (Servicegebühr)",
    };
    return map[unit] || "";
  }

  static translatePriceCategory(priceCategory, short = false) {
    let translation = "";
    if (priceCategory === "per-hour") {
      translation = "Stunde(n)";
    } else if (priceCategory === "per-day") {
      translation = "Tag(en)";
    } else if (priceCategory === "per-item") {
      translation = "Stück";
    } else if (priceCategory === "per-square-meter") {
      translation = "m²";
    }

    return short ? translation : "/" + translation;
  }

  static generateImageHtml(imgUrl, className, altText) {
    return imgUrl
      ? `<img src="${imgUrl}" class="${className}"  alt="${altText}"/>`
      : "";
  }

  static async bookablesToList(bookables, order = [], instance) {
    if (bookables.length > 0) {
      await HtmlEngine._resolveExternalPrices(bookables, bookables[0].tenantId);
    }

    let checkoutInstance = instance;
    let htmlOutput = '<ul class="booking-manager-list">';

    if (order.length > 0) {
      bookables.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }

    for (const bookable of bookables) {
      const tenantObj = await TenantManager.getTenant(bookable.tenantId);

      htmlOutput += '<li class="bt-' + bookable.type + '">';
      // The markup is embedded on foreign websites, so every media address has
      // to be absolute.
      htmlOutput += this.generateImageHtml(
        absoluteUrl(bookable.coverImageUrl),
        "cover-image",
        bookable.title,
      );
      htmlOutput += "<h4>" + (bookable.title || "") + "</h4>";
      htmlOutput +=
        '<p class="description">' + (bookable.description || "") + "</p>";
      htmlOutput += bookable?.location?.display_address
        ? '<p class="location">' +
          (bookable.location.display_address || "") +
          "</p>"
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
        checkoutInstance =
          checkoutInstance || (await InstanceManager.getInstance());
        htmlOutput +=
          '<p class="autoCommitBooking">' +
          (bookable.autoCommitBooking === true
            ? "Direkt buchbar"
            : "Individuelle Freigabe erforderlich") +
          "</p>";

        htmlOutput += '<p class="price">';

        htmlOutput += getBookablePrice(bookable);

        htmlOutput += "</p>";

        const checkoutUrl = await HtmlEngine._checkoutUrl(
          bookable.id,
          bookable.tenantId,
          checkoutInstance,
        );

        let buttonText = bookable.autoCommitBooking
          ? "Jetzt buchen"
          : "Jetzt anfragen";
        htmlOutput +=
          '<a href="' +
          checkoutUrl +
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
    await HtmlEngine._resolveExternalPrices([bookable], bookable.tenantId);
    let checkoutInstance;

    let htmlOutput = '<div class="bookable-item">';

    htmlOutput += this.generateImageHtml(
      absoluteUrl(bookable.coverImageUrl),
      "cover-image",
      bookable.title,
    );
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
        // A media attachment stores its file under `reference`, so the address
        // has to be resolved — and absolutized for the embedding website.
        .map((attachment) => enrichAttachment(attachment, bookable.tenantId))
        .forEach((attachment) => {
          htmlOutput += '<li class="attachment">';
          htmlOutput +=
            '<a href="' +
            absoluteUrl(attachment.url) +
            '" target="_blank">' +
            attachment.title +
            "</a>";
          htmlOutput += "</li>";
        });
      htmlOutput += "</ul>";
    }

    if (bookable.isBookable) {
      checkoutInstance =
        checkoutInstance || (await InstanceManager.getInstance());
      htmlOutput += bookable?.location?.display_address
        ? '<p class="location">' +
          (bookable.location.display_address || "") +
          "</p>"
        : "";
      htmlOutput += '<p class="type">' + (bookable.type || "") + "</p>";
      htmlOutput +=
        '<p class="autoCommitBooking">' +
        (bookable.autoCommitBooking === true
          ? "Direkt buchbar"
          : "Individuelle Freigabe erforderlich") +
        "</p>";

      htmlOutput += '<p class="price">';

      htmlOutput += getBookablePrice(bookable);

      htmlOutput += "</p>";

      const checkoutUrl = await HtmlEngine._checkoutUrl(
        bookable.id,
        bookable.tenantId,
        checkoutInstance,
      );

      let buttonText = bookable.autoCommitBooking
        ? "Jetzt buchen"
        : "Jetzt anfragen";
      htmlOutput +=
        '<a href="' +
        checkoutUrl +
        '" class="btn-booking" target="_blank">' +
        buttonText +
        "</a>";
    }

    let relatedBookables = (
      await BookableManager.getRelatedBookables(bookable.id, bookable.tenantId)
    ).filter((bookable) => bookable.isPublic === true);

    if (relatedBookables.length > 0) {
      htmlOutput += '<div class="related-bookable-objects">';
      htmlOutput += await HtmlEngine.bookablesToList(
        relatedBookables,
        bookable.relatedBookableIds,
        checkoutInstance,
      );
      htmlOutput += "</div>";
    }

    htmlOutput += "</div>";

    return htmlOutput;
  }

  static async eventsToList(events) {
    let htmlOutput = '<ul class="booking-manager-list">';

    for (const event of events) {
      const tenantObj = await TenantManager.getTenant(event.tenantId);

      let tags = "";
      event.information.tags.forEach((tag) => {
        tags += tag + " ";
      });

      htmlOutput += `<li class="event" rel="${tags.trim()}">`;
      htmlOutput += this.generateImageHtml(
        absoluteUrl(event.teaserImageUrl),
        "cover-image",
        event.information.name,
      );
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
        '<p class="contact-name">' +
        (event.eventOrganizer?.contactPersonName || "") +
        "</p>";
      htmlOutput +=
        '<p class="contact-phone">' +
        (event.eventOrganizer?.contactPersonPhoneNumber || "") +
        "</p>";
      htmlOutput +=
        '<p class="contact-email">' +
        (event.eventOrganizer?.contactPersonEmailAddress || "") +
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

      if (event.externalBookingUrl) {
        htmlOutput +=
          '<a class="btn-booking" href="' +
          event.externalBookingUrl +
          '" target="_blank">Jetzt buchen</a>';
      } else {
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
      }

      htmlOutput += `<a class="btn-detail" href="${tenantObj.eventDetailLink}?bkid=${event.id}">Details</a>`;

      htmlOutput += "</li>";
    }

    htmlOutput += "</ul>";

    return htmlOutput;
  }

  static async event(event, showAttachments) {
    let htmlOutput = `<div class="event">`;

    // INFORMATION
    htmlOutput += `<div class="information">`;
    htmlOutput += `<h1>Informationen</h1>`;
    htmlOutput += `<h2>${event.information.name || ""}</h2>`;
    htmlOutput += this.generateImageHtml(
      absoluteUrl(event.teaserImageUrl),
      "teaser-image",
      event.information.name,
    );
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
    htmlOutput += event.location?.address?.street
      ? `<div class="street">${[
          event.location.address.street,
          event.location.address.house_number,
        ]
          .filter(Boolean)
          .join(" ")}</div>`
      : "";
    htmlOutput += event.location?.address?.post_code
      ? `<div class="zip">${event.location.address.post_code || ""}</div>`
      : "";
    htmlOutput += event.location?.address?.city
      ? `<div class="city">${event.location.address.city || ""}</div>`
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
      let eventLocationBookable = await BookableManager.getBookable(
        event.eventLocation.room,
        event.tenantId,
      );

      htmlOutput += `<div class="room">${eventLocationBookable?.title}</div>`;
    }
    htmlOutput += event.location?.meta?.additional
      ? `<div class="additional">${event.location.meta.additional || ""}</div>`
      : "";

    htmlOutput += `</div>`;

    // EVENT ORGANIZER
    htmlOutput += `<div class="event-organizer">`;
    htmlOutput += `<h5>Veranstalter</h5>`;

    htmlOutput += `<div class="name">${event.eventOrganizer.name || ""}</div>`;

    if (event.eventOrganzier) {
      htmlOutput += this.generateImageHtml(
        absoluteUrl(event.contactPersonImageUrl),
        "contact-person-image",
        event.eventOrganizer.contactPersonName,
      );
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

    const speakers = event.speakersWithImageUrls;

    if (speakers.length > 0) {
      htmlOutput += `<h6>Referenten</h6>`;
      htmlOutput += `<ul class="speaker-list">`;

      speakers.forEach((speaker) => {
        htmlOutput += `<li class="speaker">`;
        htmlOutput += speaker.name
          ? `<div class="speaker-name">${speaker.name || ""}</div>`
          : "";
        htmlOutput += this.generateImageHtml(
          absoluteUrl(speaker.image),
          "speaker-image",
          speaker.name,
        );
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
      const imageUrls = event.imageUrls;

      event.images.forEach((image, index) => {
        htmlOutput += '<li class="event-image">';
        // The address is derived, the alt text still comes from the stored
        // entry — the markup stays the one it has always been.
        htmlOutput += this.generateImageHtml(
          absoluteUrl(imageUrls[index]),
          "event-image",
          image.name,
        );
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
          // Legacy entries are bare URLs; converted ones carry their file
          // under `reference` — either way the link has to leave absolute.
          const attachment =
            typeof eventAttachment === "string"
              ? { title: eventAttachment, url: eventAttachment }
              : enrichAttachment(eventAttachment, event.tenantId);

          htmlOutput += '<li class="event-attachment">';
          htmlOutput += `<a href="${absoluteUrl(attachment.url)}" target="_blank">${attachment.title || attachment.url}</a>`;
          htmlOutput += "</li>";
        });
        htmlOutput += "</ul>";
        htmlOutput += `</div>`;
      }
    }

    let relatedTickets = (
      await BookableManager.getBookables(event.tenantId)
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

  static getPriceRange(start, end) {
    let interval = "";
    if (!start) {
      interval = `bis ${end}`;
    }
    if (!end) {
      interval = `ab ${start}`;
    }
    if (start && end) {
      interval = `${start} - ${end}`;
    }
    return `${interval}`;
  }
}

function getBookablePrice(bookable) {
  let htmlOutput = "";

  const hasPriceWithTax = !!bookable.priceValueAddedTax;

  if (bookable.priceCategories.some((pC) => pC.priceEur) > 0) {
    htmlOutput += '<ul class="price-category-list">';
    bookable.priceCategories.forEach((priceCategory) => {
      const price = hasPriceWithTax
        ? priceCategory.priceEur * (1 + bookable.priceValueAddedTax / 100)
        : priceCategory.priceEur;

      htmlOutput += '<li class="price-category-item">';
      htmlOutput +=
        ' <span class="price-category-item-price">' +
        new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: "EUR",
        }).format(price);
      htmlOutput += priceCategory.external
        ? HtmlEngine.translateExternalUnit(priceCategory.unit)
        : HtmlEngine.translatePriceTyp(bookable.priceType);
      htmlOutput += "</span>";

      if (priceCategory.interval?.start || priceCategory.interval?.end) {
        htmlOutput +=
          ' <span class="price-category-interval">' +
          HtmlEngine.getPriceRange(
            priceCategory.interval?.start,
            priceCategory.interval?.end,
          ) +
          "</span>";
        htmlOutput +=
          ' <span class="price-category">' +
          HtmlEngine.translatePriceCategory(bookable.priceType, true) +
          "</span>";
      }

      htmlOutput += "</li>";
    });
    htmlOutput += "</ul>";
  } else {
    htmlOutput += "kostenlos";
  }

  return htmlOutput;
}

module.exports = HtmlEngine;
