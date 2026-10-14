# How the Profit page adds up — an audit guide

Written 2026-10-14 for the owner to check every rule against Walmart's own
numbers. Every figure on the Profit page comes from the statement CSVs you
import, the Returns log, your marks on Reconcile, and the costs you type on
the Pricing page. Nothing is estimated.

Code: `src/main/recovery/index.js` (function `profit`), `parseReport.js`
(function `parseOrders`), `rnr.js` (functions `deriveStatus`, `decorate`).

---

## 1. What one imported statement becomes

Each row of the CSV is one Walmart transaction line. The app keeps every
line (that is the Statement tab) and also folds the lines into **one row
per PO number** for the Profit page:

| Field on the PO row | Where it comes from |
| --- | --- |
| Units sold | the `Ship Qty` of every **Sale** line whose Amount Type is **Product Price** |
| Units refunded | the `Ship Qty` of every **Refund** line whose Amount Type is **Product Price** |
| Goods price | the sum of the **Sale · Product Price** amounts (what the customer paid for the goods, before tax and shipping) |
| Commission | the sum of the **Sale · Commission on Product** amounts |
| Walmart paid (net) | the sum of **every** line's Amount on that PO: sale, tax, commission, refund, label charges, adjustments |
| Note | the Transaction Description of any line that is not a Sale or a Refund (for example "Walmart Shipping Label Service Charge") |

A line with no PO number (storage, ads, WFS inventory adjustments, the
bank transfers) is not on any PO row. It lands in the "other" bucket and is
never part of Walmart paid or profit.

**Check it yourself.** Open the Statement tab for a period. Its Sales →
Product price must equal Goods sold on the strip for that period. In your
Sep 5 – Sep 19 file both read $539,592.41.

## 2. Which period a PO belongs to

A refund usually posts on a later statement than its sale. The Profit page
moves every refund **home to the period that sold the unit**, so the margin
of a period is on the goods that period actually sold.

- The sale row and the refund row of one PO merge into **one line**, in the
  sale's period. The line says "Refunded in a later period".
- A refund whose sale is **before your first imported statement** has no
  home. It stays where it posted and says "sold before the first statement".
- A fee-only line (no units, for example a label charge on its own) stays
  in its own period.

Because of the moves, **Walmart paid for a single period is not meant to
equal the statement's Activity**. Across all your periods it is:

```
sum of Walmart paid (all periods) + sum of "other" = sum of statement Activity
```

Your three files: 1,336,259.13 − 3,470.85 = 1,332,788.28, and the three
Activity figures add to 1,332,788.28.

## 3. The cost of a unit

- The cost is the one you typed on the Pricing page for the Linnworks SKU.
- A Walmart listing finds its Linnworks SKU through the Pricing page's
  channel map. A listing the map does not know gets a triangle and sits on
  its own.
- A cost of $0 means **no cost set**, never a free unit.
- A PO on a listing with no cost is **counted in Walmart paid but left out
  of profit and margin**. The strip's "No cost set" cell says how much.

Profit and margin are therefore measured only on the orders that have a
cost:

```
Profit  = Walmart paid on costed orders − cost of goods + money paid back from outside Walmart − expenses
Margin  = Profit ÷ Walmart paid on costed orders
```

## 4. What a refunded PO does to profit

The refund's money hit is already inside Walmart paid (the refund line is
negative). The only question is **whether the unit's cost is charged**.
The standing is judged on the PO as a whole, across every period:

| Standing | When | Cost | Line says |
| --- | --- | --- | --- |
| **Back** | the PO is in the Returns log, or you marked it Received | not charged | "back in stock · cost recovered" |
| **Never shipped** | you marked Never shipped | not charged (nothing left the warehouse) | "never shipped" |
| **Pending** | the return has not come back and the window is still open: seller-fulfilled inside 45 days, WFS inside 135 days, a case open, an adjustment parked | not charged yet, carried under **At risk** | "pending · not costed yet" |
| **Lost** | the window closed with no case, you marked Loss, Walmart wrote it off, or Walmart paid you back instead of returning the unit | charged | "cost charged" |

Notes:

- A "Lost in transit" / "Lost after delivery" refund waits out the same
  window as any other before its cost is charged (from v1.32.62). Reconcile
  still chases it from day one.
- **At risk** is the cost of every pending unit. It becomes cost of goods
  only if the window closes with nothing back.
- A unit that is both sold and refunded in the **same** PO nets its own
  sale and refund inside Walmart paid; back in stock, the PO's effect on
  profit is only the fees Walmart kept.

## 5. Refunds of sales before your first statement

These have no sale income on the page to cancel against, so the whole
refund used to land on profit even with the unit back on the shelf.

- While the unit is **back, pending or never shipped**: the refund is
  **left out of profit**. The line says "not counted against profit", and
  the Walmart paid cell says how much was left out in total.
- Once it is **lost**: the refund **stays counted**. The line says "counted
  against profit".
- Walmart paid itself is unchanged, so the statement still ties out.

## 6. Money that comes back from outside Walmart

A payout you type by hand (⋯ → Paid out…) from the shipping insurance or a
carrier is **added to profit once**, in the period of the sale. A payout
from Walmart typed by hand is **not** added, because Walmart's own payout
lands on a later statement and would be counted twice; the line just notes
it.

## 7. Goods sold, average price, commission

- **Goods sold** = the Product Price of every Sale line in the scope. Only
  orders imported with the price columns count; the strip says "N of M
  orders priced" when some period was imported before v1.32.13 and its CSV
  is not in the archive.
- **Average price** = Goods sold ÷ units on priced orders.
- **Commission %** = Commission on Product ÷ Goods sold, on the orders that
  carry both.

## 8. Expenses

Expenses you add on the Expenses tab come off the top in their scope.
Profit on the strip is after expenses; margin is after expenses.

## 9. Three checks to run on your own screen

1. **Goods sold = Statement → Sales → Product price**, period by period.
2. **All time Walmart paid + "kept aside" = sum of every statement's Activity.**
   The kept-aside amount is under the Walmart paid cell; Activity is the
   column on the Statement tab.
3. **Any PO**: open its line under By SKU. Walmart paid on the line must
   equal the sum of that PO's lines on Walmart's Payments page
   (Transactions, search by PO). The standing word must match what you see
   on Reconcile for the same PO.

If any of the three fails on a real file, send the file and the PO number.
