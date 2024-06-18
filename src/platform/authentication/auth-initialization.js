const passport = require("passport");
const UserManager = require("../../commons/data-managers/user-manager");
const LocalStrategy = require("passport-local").Strategy;
const KeycloakStrategy = require("@exlinc/keycloak-passport");
const { Issuer, Strategy: OpenIDStrategy } = require("openid-client");

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (user, done) {
  done(null, user);
});

passport.use(
  "local-signin",
  new LocalStrategy(
    {
      usernameField: "id",
      passwordField: "password",
      passReqToCallback: true,
    },
    (request, id, password, done) => {
      const tenant = request.params.tenant;

      UserManager.getUser(id, tenant).then((user) => {
        if (
          user !== undefined &&
          user.isVerified &&
          user.verifyPassword(password)
        ) {
          done(null, user);
        } else {
          done(null, false);
        }
      });
    },
  ),
);

Issuer.discover("http://localhost:8080/realms/myrealm") // replace 'myrealm' with your realm name
  .then((keycloakIssuer) => {

    const client = new keycloakIssuer.Client({
      client_id: "myclient", // replace with your client id
      client_secret: "hchNivHbWhhbVGrxpJULnJyYq5O7OETP", // replace with your client secret
      redirect_uris: ["http://localhost:8082/auth/diz/keycloak/callback"],
      post_logout_redirect_uris: ["http://localhost:8081/logout/callback"],
      response_types: ["code"],
    });

    passport.use(
      "keycloak-signin",
      new OpenIDStrategy(
        {
          client,
          params: {
            redirect_uri: "http://localhost:8082/auth/diz/keycloak/callback",
            response_type: "code",
            scope: "openid",
          },
        },
        (tokenset, userinfo, done) => {
          // Hier können Sie die Tokens und Benutzerinformationen verarbeiten
          // und den Benutzer an Ihre Anwendung weitergeben
          console.log("tokenset", tokenset);
          const user = {
            id: userinfo.sub,
            email: userinfo.email,
            firstName: userinfo.given_name,
            lastName: userinfo.family_name,
          };
          done(null, user);
        },
      ),
    );
  })
  .catch((err) => {
    console.error("Error setting up Keycloak strategy:", err);
  });
