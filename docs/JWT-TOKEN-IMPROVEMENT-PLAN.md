# JWT Token Handling Verbesserungsplan

## Aktueller Stand - Analyse

### Identifizierte Probleme

#### 1. **Inkonsistente Authentifizierung**
- `authenticateIfNeeded()` wird an verschiedenen Stellen unterschiedlich verwendet
- Manchmal in try-catch-Blöcken (json-controller.js), manchmal nicht (catalog-controller.js)
- Uneinheitliche Fehlerbehandlung führt zu unterschiedlichen Fehlerantworten

**Beispiel aktuelle Inkonsistenz:**
```javascript
// json-controller.js - Fehler werden verschluckt
try {
  identity = authenticateIfNeeded(req, true);
  if (identity) {
    userRoles = await TenantManager.getTenantUserRoles(tenantId, identity.id);
  }
} catch {
  userRoles = null;
  identity = null;
}

// catalog-controller.js - Fehler werden zurückgegeben
try {
  const user = authenticateIfNeeded(request, catalog.visibility === "private");
  if (user) request.user = user;
} catch (error) {
  console.error("Authentication error:", error);
  return response.status(401).json({ message: error.message });
}
```

#### 2. **Fehlende Token-Rotation**
- Refresh-Tokens werden zwar generiert, aber nicht in einer Blacklist verwaltet
- Alte Tokens bleiben gültig bis sie ablaufen
- Keine Token-Revocation-Mechanismus bei Logout

#### 3. **Unzureichende Token-Sicherheit**
- Keine Token-Typ-Validierung (Bearer Token ohne weitere Checks)
- Fehlende Rate-Limiting für Token-Endpoints
- Keine Token-Fingerprinting oder Device-Tracking
- Keine Schutz gegen Token-Replay-Attacken

#### 4. **Schwache Payload-Verwaltung**
```javascript
const payload = {
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName  // PII in Token - problematisch bei Token-Leaks
};
```
- Persönliche Daten im Token erhöhen Risiko bei Kompromittierung
- Keine Versionierung der Token-Struktur
- Fehlende Metadaten (iat, jti, iss, aud)

#### 5. **Keine Token-Validierungs-Middleware-Kette**
- Nur eine einfache Middleware ohne erweiterte Checks
- Keine Validierung von Token-Claims (issuer, audience, etc.)
- Keine Überprüfung ob User noch aktiv/berechtigt ist

#### 6. **Fehlende Audit-Trail**
- Keine Protokollierung von Token-Generierung und -Nutzung
- Keine Überwachung verdächtiger Token-Aktivitäten
- Keine Benachrichtigung bei Token-Anomalien

---

## Verbesserungsvorschläge - Prioritäten

### 🔴 **Kritisch (Sofort umsetzen)**

#### 1.1 Token-Blacklist für Logout implementieren
**Problem:** Tokens bleiben nach Logout gültig

**Lösung:**
- Redis-basierte Blacklist für invalidierte Tokens
- Speicherung von Token-JTI (JWT ID) mit TTL entsprechend der Ablaufzeit
- Überprüfung bei jeder Token-Validierung

**Implementierung:**
```javascript
// src/commons/services/token-blacklist-service.js
class TokenBlacklistService {
  static async addToBlacklist(jti, expiresIn) { }
  static async isBlacklisted(jti) { }
  static async removeExpired() { }
}
```

#### 1.2 Einheitliche Authentifizierungs-Middleware
**Problem:** Inkonsistente Handhabung der Authentifizierung

**Lösung:**
- Zentrale Middleware-Funktion mit einheitlicher Fehlerbehandlung
- Optionale vs. obligatorische Authentifizierung klar trennen
- Konsistente Fehlerantworten

**Implementierung:**
```javascript
// src/middleware/auth-middleware.js
const requireAuth = (req, res, next) => { }
const optionalAuth = (req, res, next) => { }
const requireRoles = (...roles) => (req, res, next) => { }
```

#### 1.3 JTI (JWT ID) zu allen Tokens hinzufügen
**Problem:** Tokens können nicht individuell identifiziert/invalidiert werden

**Lösung:**
```javascript
const payload = {
  jti: uuidv4(),  // Eindeutige Token-ID
  sub: user.id,    // Subject (User ID)
  iat: Math.floor(Date.now() / 1000),  // Issued at
  // ...
};
```

---

### 🟡 **Wichtig (Mittelfristig)**

#### 2.1 Token-Payload reduzieren
**Problem:** PII im Token erhöht Risiko bei Leaks

**Lösung:**
```javascript
const payload = {
  jti: uuidv4(),
  sub: user.id,        // Nur User ID
  type: 'access',       // Token-Typ
  v: 1                  // Token-Version
};
// Namen und andere Daten aus DB laden bei Bedarf
```

#### 2.2 Token-Rotation für Refresh-Tokens
**Problem:** Refresh-Tokens können wiederverwendet werden

**Lösung:**
- Bei jedem Refresh neues Refresh-Token ausgeben
- Altes Refresh-Token invalidieren
- Token-Familie-Tracking (wenn altes Token wiederverwendet wird, alle invalidieren)

#### 2.3 Standard JWT-Claims implementieren
**Lösung:**
```javascript
const payload = {
  jti: uuidv4(),
  sub: user.id,
  iss: 'smart-city-booking',  // Issuer
  aud: 'smart-city-api',       // Audience
  iat: now,
  exp: now + expiresIn,
  nbf: now,                     // Not before
  type: 'access'
};
```

#### 2.4 Enhanced Token-Validierung
**Implementierung:**
```javascript
// Validierung erweitern um:
- Issuer-Check
- Audience-Check  
- Token-Type-Check
- Blacklist-Check
- User-Active-Check
```

---

### 🟢 **Nice-to-have (Langfristig)**

#### 3.1 Token-Fingerprinting
**Zweck:** Schutz gegen Token-Theft

**Lösung:**
```javascript
const fingerprint = crypto.createHash('sha256')
  .update(userAgent + ipAddress + deviceId)
  .digest('hex');
// Fingerprint im Token und bei Validierung prüfen
```

#### 3.2 Rate-Limiting für Auth-Endpoints
**Implementierung:**
- Express-rate-limit für /auth/* Endpoints
- Unterschiedliche Limits für Login, Refresh, Signup
- IP-basierte und User-basierte Limits

#### 3.3 Token-Audit-Log
**Zweck:** Sicherheitsüberwachung und Compliance

**Features:**
- Protokollierung aller Token-Operationen
- Anomalie-Erkennung (z.B. Token-Nutzung von verschiedenen IPs)
- Dashboard für Security-Team

#### 3.4 Multi-Device Management
**Features:**
- Nutzer sieht alle aktiven Sessions
- Möglichkeit einzelne Sessions zu beenden
- Automatische Benachrichtigung bei neuem Login

#### 3.5 Short-lived Access Tokens mit Auto-Refresh
**Implementierung:**
- Access-Token: 15 Minuten
- Refresh-Token: 7 Tage
- Auto-Refresh im Frontend vor Ablauf
- Sliding-Session mit Refresh-Token-Rotation

---

## Implementierungs-Roadmap

### Phase 1: Sicherheits-Grundlagen (Woche 1-2)
1. ✅ Token-Blacklist Service mit Redis
2. ✅ JTI zu Tokens hinzufügen
3. ✅ Einheitliche Auth-Middleware
4. ✅ Logout mit Token-Invalidierung
5. ✅ Enhanced Token-Validierung

### Phase 2: Token-Optimierung (Woche 3-4)
1. ✅ Token-Payload reduzieren
2. ✅ Standard JWT-Claims implementieren
3. ✅ Token-Rotation für Refresh-Tokens
4. ✅ Error-Handling verbessern
5. ✅ User-Active-Status in Validierung

### Phase 3: Security-Features (Woche 5-6)
1. ✅ Rate-Limiting für Auth-Endpoints
2. ✅ Token-Fingerprinting
3. ✅ Token-Audit-Logging
4. ✅ Monitoring und Alerting

### Phase 4: UX-Verbesserungen (Woche 7-8)
1. ✅ Auto-Refresh Mechanismus
2. ✅ Multi-Device Management
3. ✅ Session-Dashboard
4. ✅ Security-Notifications

---

## Technische Dependencies

### Neue Packages
```json
{
  "redis": "^4.6.0",              // Token-Blacklist
  "ioredis": "^5.3.0",            // Alternative Redis Client
  "express-rate-limit": "^7.1.0", // Rate Limiting
  "rate-limit-redis": "^4.0.0",   // Redis Store für Rate Limiter
  "uuid": "^9.0.1"                // JTI Generierung
}
```

### Environment Variables
```env
# JWT Configuration
JWT_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<strong-secret>
JWT_EXPIRES_IN=15m               # Verkürzt von 24h
JWT_REFRESH_EXPIRES_IN=7d

# Token Security
JWT_ISSUER=smart-city-booking
JWT_AUDIENCE=smart-city-api
JWT_ENABLE_FINGERPRINT=true

# Redis für Blacklist
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=<password>
REDIS_DB=0

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000      # 15 Minuten
RATE_LIMIT_MAX_REQUESTS=100
```

---

## Migrations-Strategie

### Schrittweise Einführung
1. **Backward Compatibility:** Alte Tokens bleiben zunächst gültig
2. **Token-Versionierung:** v1 (alt) und v2 (neu) parallel unterstützen
3. **Graduelle Migration:** Nutzer erhalten neue Tokens beim nächsten Login
4. **Deprecation-Phase:** Nach 30 Tagen alte Token-Version deaktivieren

### Breaking Changes minimieren
```javascript
// Beide Token-Versionen unterstützen
static verifyToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  
  if (!decoded.v) {
    // Legacy Token (v1)
    return this.handleLegacyToken(decoded);
  }
  
  // Neues Token (v2+)
  return this.handleModernToken(decoded);
}
```

---

## Testing-Strategie

### Unit Tests
- Token-Generierung mit allen Claims
- Token-Validierung (gültig/ungültig/abgelaufen)
- Blacklist-Funktionalität
- Token-Rotation

### Integration Tests
- Login-Flow mit Token-Ausgabe
- Refresh-Token-Flow
- Logout mit Token-Invalidierung
- Rate-Limiting

### Security Tests
- Token-Manipulation-Versuche
- Replay-Attacken
- Rate-Limit-Bypass-Versuche
- Token-Theft-Szenarien

---

## Monitoring & Alerting

### Metriken
- Token-Generierungen pro Minute
- Failed Token-Validierungen
- Refresh-Token-Nutzung
- Blacklist-Größe
- Rate-Limit-Hits

### Alerts
- Ungewöhnlich viele fehlgeschlagene Validierungen
- Rate-Limit häufig erreicht
- Token-Replay-Versuche erkannt
- Blacklist-Größe kritisch

---

## Dokumentation

### Developer Documentation
- API-Dokumentation aktualisieren
- Authentication-Flow-Diagramme
- Code-Beispiele für Token-Nutzung
- Migration-Guide für alte Token-Struktur

### Security Documentation
- Threat-Model für JWT-Handling
- Security Best Practices
- Incident-Response-Playbook
- Audit-Log-Analyse-Guide

---

## Kosten-Nutzen-Analyse

### Vorteile
✅ Signifikant verbesserte Sicherheit
✅ Schutz gegen Token-Theft und Replay-Attacken
✅ Compliance-Ready (DSGVO, Audit-Trail)
✅ Bessere User Experience (Auto-Refresh, Multi-Device)
✅ Wartbarkeit und Konsistenz

### Kosten
- Entwicklungszeit: ~6-8 Wochen
- Redis-Infrastruktur: ~minimal (kann shared genutzt werden)
- Performance-Overhead: ~minimal (Redis ist sehr schnell)
- Testing-Aufwand: ~1-2 Wochen

### ROI
- Verhindert potenzielle Security-Breaches
- Reduziert Support-Aufwand (Session-Management)
- Erfüllt Compliance-Anforderungen
- Verbessert User-Retention (bessere UX)

---

## Nächste Schritte

1. **Review dieses Plans** mit dem Team
2. **Priorisierung** der Features bestätigen
3. **Redis-Setup** vorbereiten (Dev/Staging/Prod)
4. **Phase 1 starten** mit Token-Blacklist Implementation
5. **Testing-Environment** aufsetzen
6. **Rollout-Plan** für Production erstellen

---

## Anhang

### Referenzen
- [RFC 7519 - JSON Web Token](https://tools.ietf.org/html/rfc7519)
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)

### Code-Beispiele
Siehe separates Dokument: `JWT-IMPLEMENTATION-EXAMPLES.md` (erstellt im nächsten Schritt)

---

**Erstellt:** 2025-11-10
**Version:** 1.0
**Autor:** GitHub Copilot
**Status:** Ready for Review

