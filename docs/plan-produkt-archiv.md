# Plan — Produkt-Archiv („ausgebraucht")

> **Status: gebaut** (Migration `0010_product_archived_at`, live im Browser
> verifiziert). Erstellt: 2026-09-05 · Basis: `main` @ `66d15ff`.

**Das Problem in einem Satz:** Ein Futter oder Dünger geht zur Neige, aber
die einzige Möglichkeit, es vom Regal zu nehmen, war das Löschen — das aber
„nie wirklich existiert" bedeutet und jegliche Spur wirft.

**Die Kernentscheidung: Archiv ≠ Löschen.** `archived_at` (nullable) ist ein
eigener Zustand neben `deleted_at`: „ausgebraucht, aber wirklich besessen
gewesen". Archivierte Produkte bleiben sichtbar (einklappbare Archiv-Sektion
im Lager), sind reaktivierbar (gleiche Flasche wieder gekauft — Dosis- und
Provenance-Zeilen bleiben erhalten), und der Name darf neu angelegt werden
(Partial-Unique-Index gilt nur für lebende Zeilen, Migration `0010` baut ihn
um). Löschen bleibt, was es war: Tippfehler, Import-Irrtum.

## Was beim Archivieren passiert

1. **Erkennen VOR dem Schreiben** (`plansUsingProductDetailed`): Welche
   Pläne verlieren etwas? Ehrlich, nicht theoretisch:
   - **Düngepläne** zählen nur, wenn archivieren einen gedüngten Nährstoff
     ohne Lieferanten lässt (`coverFertilizePlan`, „letzter Lieferant") —
     ein redundanter zweiter Eisendünger ändert nichts und wird nicht
     gemeldet. Alternativ: Plan-Details nennen den Produktnamen.
   - **Fütterungspläne** (Markdown) zählen bei schlichtem Namens-Vorkommen —
     die Exakt-Namen-Regel macht Text-Match zum Vertrag.
2. **Schreiben**: `archived_at` setzen. Danach ist das Produkt aus
   `listProducts` (Regal, **Coach-Kontext**, Plandeckung) und aus dem
   Fütterplan-Entwurf (`foodsDirective`) — der Kontext listet es stattdessen
   in einer Zeile „used up (NOT on the shelf anymore — do not recommend dosing
   these)", damit der Coach eine Deckungslücke erklären und „was soll ich
   kaufen" beantworten kann, ohne das Produkt je zu empfehlen.
3. **Anbieten, nicht automatically** (Owner-Entscheidung): Die UI zeigt die
   betroffenen Pläne als Links (Tank-Seite) **plus** einen Coach-Link mit
   vorgefertigter Frage („Produkt X ist ausgebraucht — bitte Pläne
   überprüfen und Aktualisierungen vorschlagen"). Kein automatischer
   KI-Aufruf: Der Vorschlag kostet Budget, also entscheidet der Klick.

## Umsetzung

| Baustein | Ort |
|---|---|
| Spalte + Index | `0010`: `archived_at`; Unique nur über `deleted_at IS NULL AND archived_at IS NULL` |
| Cores | `archiveProductCore` (liefert `affected` zurück), `unarchiveProductCore` (verweigert belegten Namen → `product.duplicateName`), `listArchivedProducts` |
| Actions | `archiveProduct` / `unarchiveProduct` (revalidiert Regal, Tanks, Dashboard, Coach) |
| UI | Archiv-Icon je Karte; Hinweis-Box auf Sektions-Ebene (die Karte verschwindet ja im Refresh) mit Plan-Links + Coach-Link; Archiv-`<details>` mit „Zurück aufs Regal" |
| Export | `productRowSchema.archivedAt` (optional → alte Exporte importierbar); Roundtrip-Test |

## Grenzen (bewusst)

- **Keine Bestandsmengen**: „alle" ist ein Zustand, keine Zahl — eine
  Füllstandsanzeige wäre ein eigenes Feature.
- **Kein automatisches Plan-Umschreiben**: Der Coach schlägt vor (Approval-
  Gate wie immer), die Links führen dahin; mechanisch Dosen aus Plänen
  streichen würde falsch sein — die Pflanze braucht das Eisen weiter, nur
  eben von einem neuen Produkt.
