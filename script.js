/* ==========================================================================
   Διαγνωστικό R-507 · Λογική εφαρμογής (script.js)
   --------------------------------------------------------------------------
   Όλη η λογική γίνεται client-side. Δεν υπάρχει backend.
   Ενότητες:
     1) Σταθερές & πίνακας R-507 (από -60°C έως +50°C)
     2) Βοηθητικές συναρτήσεις (interpolation, format, partial check)
     3) Όρια αξιολόγησης (Standard / MT vs Ultra-Low / LT)
     4) Συναρτήσεις αξιολόγησης (επιστρέφουν και πιθανές αιτίες)
     5) Κύρια συνάρτηση calculate() & render
     6) Event listeners
   ========================================================================== */


/* --------------------------------------------------------------------------
   1) ΣΤΑΘΕΡΕΣ & ΠΙΝΑΚΑΣ R-507A
   --------------------------------------------------------------------------
   Πίνακας κορεσμού P/T για R-507A:
   - Πιέσεις σε bar gauge (πίεση μανόμετρου, σχετική).
   - Θερμοκρασίες σε °C.
   - Εύρος: -60°C έως +50°C, βήμα 5°C.
   - Αρνητικές τιμές αντιστοιχούν σε υποπίεση (vacuum).
   Παρεμβολή ανάμεσα στα γειτονικά σημεία (γραμμική).
   Σημείωση: τιμές κατά προσέγγιση από αναφορές κατασκευαστών — για κρίσιμη
   χρήση χρησιμοποιήστε επίσημους πίνακες.
   -------------------------------------------------------------------------- */
const R507_PT_TABLE = [
  // { T: θερμοκρασία °C, P: πίεση bar gauge }
  { T: -60, P: -0.68 },
  { T: -55, P: -0.51 },
  { T: -50, P: -0.30 },
  { T: -45, P: -0.05 },
  { T: -40, P:  0.27 },
  { T: -35, P:  0.66 },
  { T: -30, P:  1.13 },
  { T: -25, P:  1.69 },
  { T: -20, P:  2.34 },
  { T: -15, P:  3.10 },
  { T: -10, P:  3.99 },
  { T:  -5, P:  5.00 },
  { T:   0, P:  6.16 },
  { T:   5, P:  7.46 },
  { T:  10, P:  8.94 },
  { T:  15, P: 10.59 },
  { T:  20, P: 12.43 },
  { T:  25, P: 14.48 },
  { T:  30, P: 16.74 },
  { T:  35, P: 19.24 },
  { T:  40, P: 21.99 },
  { T:  45, P: 25.01 },
  { T:  50, P: 28.31 },
];

// Ατμοσφαιρική πίεση σε bar — για μετατροπή gauge → absolute
const P_ATM = 1.013;


/* --------------------------------------------------------------------------
   2) ΒΟΗΘΗΤΙΚΕΣ ΣΥΝΑΡΤΗΣΕΙΣ
   -------------------------------------------------------------------------- */

/**
 * Επιστρέφει τη θερμοκρασία κορεσμού του R-507 για δοθείσα πίεση gauge.
 * Χρησιμοποιεί ΓΡΑΜΜΙΚΗ ΠΑΡΕΜΒΟΛΗ ανάμεσα στα δύο κοντινότερα σημεία
 * του πίνακα. Δεν χρησιμοποιεί "nearest value" — επιστρέφει την ακριβή
 * παρεμβαλλόμενη τιμή.
 *
 * Αν η πίεση είναι εκτός εύρους πίνακα, γίνεται clamp στο πιο κοντινό άκρο.
 *
 * @param {number} pGauge - πίεση μανόμετρου σε bar
 * @returns {number} θερμοκρασία κορεσμού σε °C
 */
function satTempFromPressure(pGauge) {
  // Έλεγχος εκτός εύρους — clamp στα άκρα
  if (pGauge <= R507_PT_TABLE[0].P) {
    return R507_PT_TABLE[0].T;
  }
  if (pGauge >= R507_PT_TABLE[R507_PT_TABLE.length - 1].P) {
    return R507_PT_TABLE[R507_PT_TABLE.length - 1].T;
  }

  // Εύρεση των δύο γειτονικών σημείων
  for (let i = 0; i < R507_PT_TABLE.length - 1; i++) {
    const a = R507_PT_TABLE[i];
    const b = R507_PT_TABLE[i + 1];
    if (pGauge >= a.P && pGauge <= b.P) {
      // Γραμμική παρεμβολή:
      //   T = T_a + (T_b - T_a) * (P - P_a) / (P_b - P_a)
      const ratio = (pGauge - a.P) / (b.P - a.P);
      return a.T + (b.T - a.T) * ratio;
    }
  }

  // Fallback (θεωρητικά μη προσβάσιμο)
  return R507_PT_TABLE[0].T;
}

/**
 * Διαβάζει αριθμητική τιμή από input. Επιστρέφει null αν κενό ή μη έγκυρο.
 */
function readNumber(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const raw = el.value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Μορφοποιεί αριθμό με δεκαδικά και ελληνικό κόμμα (3.456 -> "3,46").
 */
function fmt(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(decimals).replace('.', ',');
}

/**
 * Ελέγχει αν μια ενότητα έχει πλήρως, μερικώς ή καθόλου συμπληρωθεί.
 *   isFull / isPartial / isEmpty + missing names array
 */
function checkPartial(values, names) {
  const missing = [];
  const filled  = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) missing.push(names[i]);
    else                    filled.push(names[i]);
  }
  return {
    isFull:    missing.length === 0,
    isEmpty:   filled.length === 0,
    isPartial: filled.length > 0 && missing.length > 0,
    missing,
  };
}

/**
 * Επιστρέφει τη "χειρότερη" κατάσταση από έναν πίνακα status.
 *   'danger' > 'warn' > 'ok'
 */
function worstStatus(statuses) {
  if (statuses.includes('danger')) return 'danger';
  if (statuses.includes('warn'))   return 'warn';
  return 'ok';
}

/**
 * Επιστρέφει το επιλεγμένο mode από τα radio buttons.
 *   'standard' (MT - μέσες θερμοκρασίες) ή 'ult' (LT/Ultra-Low Temp).
 */
function getMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : 'standard';
}


/* --------------------------------------------------------------------------
   3) ΟΡΙΑ ΑΞΙΟΛΟΓΗΣΗΣ
   --------------------------------------------------------------------------
   Διαφορετικά κριτήρια για:
   - Κανονική (Standard / MT): τυπικές εφαρμογές μεσαίων θερμοκρασιών
     (συντήρηση, ψύξη πάνω από -25°C εξάτμιση).
   - Χαμηλή (Ultra-Low / LT): εφαρμογές χαμηλής θερμοκρασίας όπου
     ο συμπιεστής λειτουργεί σε δυσμενέστερες συνθήκες — τα όρια
     είναι πιο επιεική σε superheat & κατάθλιψη.
   -------------------------------------------------------------------------- */
const LIMITS = {
  standard: {
    label: 'Κανονική / MT',
    // Superheat χαμηλής πλευράς
    superheat: { okLow: 8,  okHigh: 22,  warnLow: 5,  warnHigh: 32 },
    // Subcooling υψηλής πλευράς
    subcooling:{ okLow: 2,  okHigh: 10,   warnLow: 1,  warnHigh: 14 },
    // Θερμοκρασία κατάθλιψης
    discharge: { okMax: 115, warnMax: 140 },
    // Σχέση συμπίεσης ανά βαθμίδα
    stageRatio:{ okMax: 5,  warnMax: 7 },
    // Συνολική σχέση συμπίεσης (διβάθμιο)
    totalRatio:{ okMax: 15, warnMax: 25 },
  },
  ult: {
    label: 'Χαμηλή / Ultra-Low Temp',
    // Στις ULT εφαρμογές το superheat τυπικά είναι λίγο υψηλότερο
    superheat: { okLow: 8,  okHigh: 22,  warnLow: 5,  warnHigh: 32 },
    // Το subcooling συχνά είναι μικρότερο σε ULT
    subcooling:{ okLow: 2,  okHigh: 10,   warnLow: 1,  warnHigh: 14 },
    // Σε ULT η κατάθλιψη ανεβαίνει — πιο επιεική όρια
    discharge: { okMax: 115, warnMax: 140 },
    // Οι σχέσεις συμπίεσης είναι πιο υψηλές
    stageRatio:{ okMax: 6,  warnMax: 8 },
    totalRatio:{ okMax: 25, warnMax: 40 },
  },
};


/* --------------------------------------------------------------------------
   4) ΣΥΝΑΡΤΗΣΕΙΣ ΑΞΙΟΛΟΓΗΣΗΣ
   --------------------------------------------------------------------------
   Κάθε συνάρτηση επιστρέφει:
     {
       status:  'ok' | 'warn' | 'danger',
       tag:     σύντομη ετικέτα (π.χ. "Πιθανή έλλειψη ψυκτικού") — string ή null
       message: αναλυτικό μήνυμα
       causes:  πίνακας πιθανών αιτιών (string[]) — άδειος για OK
     }
   -------------------------------------------------------------------------- */

/**
 * Αξιολόγηση superheat χαμηλής πλευράς.
 */
function evaluateSuperheat(sh, mode) {
  const L = LIMITS[mode].superheat;

  if (sh < L.warnLow) {
    // Πολύ χαμηλό — κίνδυνος επιστροφής υγρού
    return {
      status: 'danger',
      tag: 'Πιθανή επιστροφή υγρού',
      message: `Πολύ χαμηλό superheat (${fmt(sh,1)}°C). Κίνδυνος επιστροφής υγρού στον συμπιεστή.`,
      causes: [
        'Υπερτροφοδοσία εκτονωτικής βαλβίδας (ανοιχτή πολύ)',
        'Πιθανή βλάβη αισθητηρίου TXV/EEV',
        'Λάθος ρύθμιση ή βλάβη αισθητηρίου TXV/EEV',
        'Πιθανή υπερπλήρωση ψυκτικού στο σύστημα',
        'Κακή θέση/επαφή του αισθητηρίου εκτονωτικής στον σωλήνα αναρρόφησης',
      ],
    };
  }
  if (sh < L.okLow) {
    return {
      status: 'warn',
      tag: 'Οριακά χαμηλό superheat',
      message: `Οριακά χαμηλό superheat (${fmt(sh,1)}°C). Απαιτείται έλεγχος.`,
      causes: [
        'Ήπια υπερτροφοδοσία εκτονωτικής',
        'Πιθανώς ελαφρώς υψηλή πλήρωση',
        'Ρύθμιση superheat εκτονωτικής εκτός βέλτιστου',
      ],
    };
  }
  if (sh <= L.okHigh) {
    return {
      status: 'ok',
      tag: null,
      message: `Καλό superheat (${fmt(sh,1)}°C) — εντός τυπικού εύρους.`,
      causes: [],
    };
  }
  if (sh <= L.warnHigh) {
    return {
      status: 'warn',
      tag: 'Πιθανή υποτροφοδότηση',
      message: `Αυξημένο superheat (${fmt(sh,1)}°C). Πιθανή υποτροφοδότηση εκτονωτικής.`,
      causes: [
        'Ελαφρά έλλειψη ψυκτικού',
        'Υποτροφοδότηση εκτονωτικής βαλβίδας',
        'Μερική φραγή φίλτρου dryer',
        'Έλεγχος ρύθμισης superheat',
      ],
    };
  }
  // sh > warnHigh — υψηλό superheat
  return {
    status: 'danger',
    tag: 'Πιθανή έλλειψη ψυκτικού',
    message: `Υψηλό superheat (${fmt(sh,1)}°C). Πιθανή έλλειψη ή κακή τροφοδοσία, αν επιβεβαιώνεται και από άλλες μετρήσεις.`,
    causes: [
      'Έλλειψη ψυκτικού στο σύστημα (διαρροή)',
      'Βουλωμένη ή κλειστή εκτονωτική βαλβίδα',
      'Λάθος ρύθμιση ή βλάβη αισθητηρίου TXV/EEV',
      'Φραγή φίλτρου dryer ή γραμμής υγρού',
      'Βουλωμένος ή ακαθάριστος εξατμιστής',
      'Ανεπαρκής τροφοδοσία ψυκτικού στον εξατμιστή',
    ],
  };
}

/**
 * Αξιολόγηση subcooling υψηλής πλευράς.
 */
function evaluateSubcooling(sc, mode) {
  const L = LIMITS[mode].subcooling;

  if (sc < L.warnLow) {
    return {
      status: 'danger',
      tag: 'Πιθανή έλλειψη ψυκτικού',
      message: `Πολύ χαμηλό subcooling (${fmt(sc,1)}°C). Πιθανή έλλειψη ψυκτικού.`,
      causes: [
        'Έλλειψη ψυκτικού στο σύστημα (διαρροή)',
        'Ανεπαρκής συμπύκνωση — έλεγχος συμπυκνωτή',
        'Πιθανός flash gas στη γραμμή υγρού',
      ],
    };
  }
  if (sc < L.okLow) {
    return {
      status: 'warn',
      tag: 'Οριακά χαμηλό subcooling',
      message: `Οριακά χαμηλό subcooling (${fmt(sc,1)}°C). Έλεγχος πλήρωσης.`,
      causes: [
        'Πιθανή ήπια έλλειψη ψυκτικού',
        'Έλεγχος ψύξης συμπυκνωτή',
        'Πιθανή μη συμπαγής στήλη υγρού',
      ],
    };
  }
  if (sc <= L.okHigh) {
    return {
      status: 'ok',
      tag: null,
      message: `Καλό subcooling (${fmt(sc,1)}°C) — εντός τυπικού εύρους.`,
      causes: [],
    };
  }
  if (sc <= L.warnHigh) {
    return {
      status: 'warn',
      tag: 'Πιθανή ήπια υπερπλήρωση',
      message: `Αυξημένο subcooling (${fmt(sc,1)}°C). Πιθανή υπερπλήρωση.`,
      causes: [
        'Ήπια υπερπλήρωση ψυκτικού',
        'Χαμηλή θερμοκρασία περιβάλλοντος (υπερβολική υπόψυξη)',
        'Έλεγχος ρύθμισης ανεμιστήρων συμπυκνωτή',
      ],
    };
  }
  // sc > warnHigh
  return {
    status: 'danger',
    tag: 'Πιθανή υπερπλήρωση ή φραγή',
    message: `Πολύ υψηλό subcooling (${fmt(sc,1)}°C). Πιθανή υπερπλήρωση ή φραγή γραμμής υγρού.`,
    causes: [
      'Σημαντική υπερπλήρωση ψυκτικού',
      'Φραγή στη γραμμή υγρού',
      'Βουλωμένο φίλτρο dryer',
      'Μερική φραγή εκτονωτικής βαλβίδας',
    ],
  };
}

/**
 * Αξιολόγηση θερμοκρασίας κατάθλιψης συμπιεστή.
 */
function evaluateDischarge(t, mode) {
  const L = LIMITS[mode].discharge;

  if (t < L.okMax) {
    return {
      status: 'ok',
      tag: null,
      message: `Κανονική θερμοκρασία κατάθλιψης (${fmt(t,1)}°C).`,
      causes: [],
    };
  }
  if (t <= L.warnMax) {
    return {
      status: 'warn',
      tag: 'Αυξημένη κατάθλιψη',
      message: `Αυξημένη θερμοκρασία κατάθλιψης (${fmt(t,1)}°C). Προσοχή.`,
      causes: [
        'Πιθανή υψηλή σχέση συμπίεσης',
        'Ακάθαρτος ή υπερφορτωμένος συμπυκνωτής',
        'Υψηλή θερμοκρασία περιβάλλοντος',
        'Πιθανώς υψηλό superheat στην αναρρόφηση',
      ],
    };
  }
  // t > warnMax
  return {
    status: 'danger',
    tag: 'Υψηλή θερμοκρασία κατάθλιψης',
    message: `Πολύ υψηλή θερμοκρασία κατάθλιψης (${fmt(t,1)}°C). Κίνδυνος υπερθέρμανσης συμπιεστή.`,
    causes: [
      'Πολύ υψηλή σχέση συμπίεσης',
      'Σοβαρή έλλειψη ψυκτικού (ανεπαρκής ψύξη συμπιεστή)',
      'Ακάθαρτος ή ανεπαρκής συμπυκνωτής',
      'Υψηλό superheat στην αναρρόφηση',
      'Φθαρμένος συμπιεστής / κακή λίπανση',
      'Δυσλειτουργία ανεμιστήρων συμπυκνωτή',
    ],
  };
}

/**
 * Αξιολόγηση ενδιάμεσου superheat.
 */
function evaluateMidSuperheat(sh) {
  if (sh < 0) {
    return {
      status: 'danger',
      tag: 'Πιθανή επιστροφή υγρού',
      message: `Αρνητικό ενδιάμεσο superheat (${fmt(sh,1)}°C). Πιθανή παρουσία υγρού στο 2ο στάδιο.`,
      causes: [
        'Υπερτροφοδοσία intercooler / liquid injection',
        'Δυσλειτουργία αισθητηρίου ενδιάμεσης ψύξης',
        'Λάθος μέτρηση — έλεγχος θέσης αισθητηρίου',
      ],
    };
  }
  if (sh < 3) {
    return {
      status: 'warn',
      tag: 'Χαμηλό ενδιάμεσο SH',
      message: `Χαμηλό ενδιάμεσο superheat (${fmt(sh,1)}°C).`,
      causes: [
        'Υπερβολική ψύξη ενδιάμεσης βαθμίδας',
        'Πιθανώς ανοιχτή ενδιάμεση injection',
      ],
    };
  }
  if (sh <= 25) {
    return {
      status: 'ok',
      tag: null,
      message: `Ενδιάμεσο superheat ${fmt(sh,1)}°C — λογικό εύρος.`,
      causes: [],
    };
  }
  return {
    status: 'warn',
    tag: 'Υψηλό ενδιάμεσο SH',
    message: `Αυξημένο ενδιάμεσο superheat (${fmt(sh,1)}°C).`,
    causes: [
      'Ανεπαρκής ψύξη μεταξύ βαθμίδων',
      'Πιθανή έλλειψη ψυκτικού στο ενδιάμεσο',
      'Φραγή στη γραμμή ενδιάμεσης βαθμίδας',
    ],
  };
}

/**
 * Αξιολόγηση σχέσης συμπίεσης μιας βαθμίδας.
 */
function evaluateStageRatio(r, mode) {
  const L = LIMITS[mode].stageRatio;
  if (r < L.okMax)            return { status: 'ok',     label: 'Φυσιολογική' };
  if (r <= L.warnMax)         return { status: 'warn',   label: 'Αυξημένη' };
  return                             { status: 'danger', label: 'Υψηλή' };
}

/**
 * Αξιολόγηση συνολικής σχέσης συμπίεσης (διβάθμιου).
 */
function evaluateTotalRatio(r, mode) {
  const L = LIMITS[mode].totalRatio;
  if (r < L.okMax)            return { status: 'ok',     label: 'Φυσιολογική' };
  if (r <= L.warnMax)         return { status: 'warn',   label: 'Αυξημένη' };
  return                             { status: 'danger', label: 'Υψηλή' };
}



/**
 * Αξιολόγηση υδρόψυκτου συμπυκνωτή / πύργου ψύξης.
 * Χρησιμοποιεί:
 * - υψηλή πίεση -> θερμοκρασία συμπύκνωσης R507
 * - θερμοκρασία νερού εισόδου/εξόδου
 * - ΔΤ νερού
 *
 * Στόχος: να ξεχωρίσει πιθανές αιτίες υψηλής πίεσης:
 * - ζεστό νερό/πύργος ψύξης
 * - χαμηλή παροχή ή βούλωμα υδρόψυκτου συμπυκνωτή
 * - πιθανός αέρας / μη συμπυκνώσιμα
 */
function evaluateCondenserWater(pHigh, tWaterIn, tWaterOut) {
  const tCond = satTempFromPressure(pHigh);      // θερμοκρασία συμπύκνωσης από PT R507
  const waterDT = tWaterOut - tWaterIn;          // ΔΤ νερού
  const approachIn = tCond - tWaterIn;           // πόσο πιο πάνω είναι η συμπύκνωση από το νερό εισόδου
  const approachOut = tCond - tWaterOut;         // πόσο πιο πάνω είναι η συμπύκνωση από το νερό εξόδου

  let status = 'ok';
  let tag = null;
  let causes = [];
  let message = `Η πλευρά του υδρόψυκτου συμπυκνωτή φαίνεται λογική. ΔΤ νερού ${fmt(waterDT,1)}°C.`;

  // Προφανές λάθος μέτρησης
  if (waterDT < 0) {
    return {
      status: 'warn',
      tag: 'Έλεγχος μετρήσεων νερού',
      message: 'Η θερμοκρασία εξόδου νερού είναι μικρότερη από την είσοδο. Ελέγξτε αν αντιστράφηκαν οι μετρήσεις.',
      causes: [
        'Αντιστροφή αισθητηρίων εισόδου/εξόδου',
        'Λάθος σημείο μέτρησης',
        'Ανακριβές θερμόμετρο',
      ],
      metrics: { tCond, waterDT, approachIn, approachOut }
    };
  }

  // Ζεστό νερό εισόδου => πιθανό πρόβλημα πύργου ή περιβάλλοντος
  if (tWaterIn >= 32) {
    status = 'warn';
    tag = 'Πιθανό πρόβλημα πύργου ψύξης';
    message = `Το νερό εισόδου είναι ζεστό (${fmt(tWaterIn,1)}°C). Αυτό μπορεί να ανεβάζει την υψηλή πίεση.`;
    causes.push(
      'Υψηλή θερμοκρασία περιβάλλοντος',
      'Πύργος ψύξης βρώμικος ή ανεπαρκής',
      'Ανεμιστήρας πύργου δεν δουλεύει σωστά',
      'Μπεκ/διανομή νερού πύργου βουλωμένα',
      'Χαμηλή στάθμη ή κακή κυκλοφορία νερού'
    );
  }

  // Μεγάλο ΔΤ νερού => χαμηλή παροχή / βούλωμα / αντλία
  if (waterDT >= 8) {
    status = status === 'ok' ? 'warn' : status;
    tag = tag || 'Χαμηλή παροχή νερού';
    message = `Μεγάλο ΔΤ νερού (${fmt(waterDT,1)}°C). Πιθανή χαμηλή παροχή ή βούλωμα στον υδρόψυκτο συμπυκνωτή.`;
    causes.push(
      'Χαμηλή παροχή νερού',
      'Βουλωμένος υδρόψυκτος συμπυκνωτής',
      'Βουλωμένο φίλτρο νερού / strainer',
      'Πρόβλημα αντλίας νερού',
      'Μερικώς κλειστή βάνα νερού'
    );
  }

  // Πολύ μικρό ΔΤ με υψηλή συμπύκνωση μπορεί να δείχνει fouling/κακή μεταφορά θερμότητας
  if (waterDT <= 2 && approachIn >= 18) {
    status = 'warn';
    tag = 'Πιθανή κακή μεταφορά θερμότητας';
    message = `Μικρό ΔΤ νερού (${fmt(waterDT,1)}°C) αλλά μεγάλη διαφορά συμπύκνωσης-νερού εισόδου (${fmt(approachIn,1)}°C).`;
    causes.push(
      'Άλατα / επικαθίσεις στον υδρόψυκτο συμπυκνωτή',
      'Λάθος μέτρηση υψηλής πίεσης ή θερμοκρασίας νερού',
      'Πιθανός αέρας / μη συμπυκνώσιμα αν το νερό είναι σωστό'
    );
  }

  // Κλασική υποψία αέρα/non-condensables:
  // υψηλή θερμοκρασία συμπύκνωσης σε σχέση με νερό, ενώ το νερό δεν φαίνεται ζεστό και το ΔΤ είναι λογικό
  if (approachIn >= 20 && tWaterIn < 30 && waterDT >= 3 && waterDT <= 7) {
    status = 'danger';
    tag = 'Πιθανός αέρας / μη συμπυκνώσιμα';
    message = `Η θερμοκρασία συμπύκνωσης είναι πολύ ψηλά σε σχέση με το νερό εισόδου. Πιθανός αέρας ή μη συμπυκνώσιμα στο κύκλωμα.`;
    causes.push(
      'Αέρας / μη συμπυκνώσιμα αέρια στο ψυκτικό κύκλωμα',
      'Κακή διαδικασία κενού πριν την πλήρωση',
      'Είσοδος αέρα από διαρροή σε σημείο υποπίεσης',
      'Υπερπλήρωση ψυκτικού μπορεί επίσης να ανεβάσει την υψηλή πίεση'
    );
  }

  // Αφαίρεση διπλότυπων αιτιών
  causes = [...new Set(causes)];

  return {
    status,
    tag,
    message,
    causes,
    metrics: { tCond, waterDT, approachIn, approachOut }
  };
}


/* --------------------------------------------------------------------------
   5) ΚΥΡΙΑ ΣΥΝΑΡΤΗΣΗ ΥΠΟΛΟΓΙΣΜΟΥ & RENDER
   -------------------------------------------------------------------------- */

function calculate() {
  // ----- 5.1 Ανάγνωση εισόδων -----------------------------------------
  const mode      = getMode();                  // 'standard' ή 'ult'
  const pLow      = readNumber('p-low');
  const tLow      = readNumber('t-low');
  const pHigh     = readNumber('p-high');
  const tLiquid   = readNumber('t-liquid');
  const pMid      = readNumber('p-mid');
  const tMid      = readNumber('t-mid');
  const tDis      = readNumber('t-discharge');
  const tWaterIn  = readNumber('t-water-in');
  const tWaterOut = readNumber('t-water-out');

  // Συλλογή ζητημάτων για τη συνολική διάγνωση
  const issues       = [];   // { status, tag, message }
  const evaluated    = [];
  const notEvaluated = [];

  // Ενημέρωση mode indicator στην επικεφαλίδα αποτελεσμάτων
  updateModeIndicator(mode);

  // ----- 5.2 Χαμηλή πλευρά --------------------------------------------
  const lowCheck = checkPartial(
    [pLow, tLow],
    ['πίεση αναρρόφησης', 'θερμοκρασία σωλήνα αναρρόφησης']
  );

  if (lowCheck.isFull) {
    const pAbs      = pLow + P_ATM;              // απόλυτη πίεση
    const tSat      = satTempFromPressure(pLow); // θερμοκρασία κορεσμού (μέσω παρεμβολής)
    const superheat = tLow - tSat;
    const ev        = evaluateSuperheat(superheat, mode);

    renderResultCard('result-low', {
      title:  'Χαμηλή πλευρά / Αναρρόφηση',
      status: ev.status,
      tag:    ev.tag,
      metrics: [
        { label: 'Πίεση gauge',           value: fmt(pLow, 2),       unit: 'bar' },
        { label: 'Θερμ. κορεσμού',        value: fmt(tSat, 1),       unit: '°C' },
        { label: 'Θερμ. σωλήνα',          value: fmt(tLow, 1),       unit: '°C' },
        { label: 'Superheat',             value: fmt(superheat, 1),  unit: '°C' },
      ],
      message: ev.message,
      causes:  ev.causes,
    });

    evaluated.push('χαμηλή πλευρά');
    if (ev.status !== 'ok') {
      issues.push({ status: ev.status, tag: ev.tag, message: ev.message });
    }
  } else if (lowCheck.isPartial) {
    renderResultCard('result-low', {
      title: 'Χαμηλή πλευρά / Αναρρόφηση',
      status: 'info',
      tag: null,
      metrics: [],
      message: 'Συμπληρώστε ακόμη: ' + lowCheck.missing.join(', ') +
               '. Χρειάζονται και τα δύο πεδία για υπολογισμό superheat.',
      causes: [],
    });
    notEvaluated.push('χαμηλή πλευρά');
  } else {
    clearResultCard('result-low');
    notEvaluated.push('χαμηλή πλευρά');
  }

  // ----- 5.3 Υψηλή πλευρά ---------------------------------------------
  const highCheck = checkPartial(
    [pHigh, tLiquid],
    ['πίεση υψηλής', 'θερμοκρασία γραμμής υγρού']
  );

  if (highCheck.isFull) {
    const pAbs       = pHigh + P_ATM;
    const tSat       = satTempFromPressure(pHigh);
    const subcooling = tSat - tLiquid;
    const ev         = evaluateSubcooling(subcooling, mode);

    renderResultCard('result-high', {
      title:  'Υψηλή πλευρά / Συμπύκνωση',
      status: ev.status,
      tag:    ev.tag,
      metrics: [
        { label: 'Πίεση gauge',           value: fmt(pHigh, 2),       unit: 'bar' },
        { label: 'Θερμ. συμπύκνωσης',     value: fmt(tSat, 1),        unit: '°C' },
        { label: 'Θερμ. γραμμής υγρού',   value: fmt(tLiquid, 1),     unit: '°C' },
        { label: 'Subcooling',            value: fmt(subcooling, 1),  unit: '°C' },
      ],
      message: ev.message,
      causes:  ev.causes,
    });

    evaluated.push('υψηλή πλευρά');
    if (ev.status !== 'ok') {
      issues.push({ status: ev.status, tag: ev.tag, message: ev.message });
    }
  } else if (highCheck.isPartial) {
    renderResultCard('result-high', {
      title: 'Υψηλή πλευρά / Συμπύκνωση',
      status: 'info',
      tag: null,
      metrics: [],
      message: 'Συμπληρώστε ακόμη: ' + highCheck.missing.join(', ') +
               '. Χρειάζονται και τα δύο πεδία για υπολογισμό subcooling.',
      causes: [],
    });
    notEvaluated.push('υψηλή πλευρά');
  } else {
    clearResultCard('result-high');
    notEvaluated.push('υψηλή πλευρά');
  }

  // ----- 5.4 Ενδιάμεση βαθμίδα ----------------------------------------
  const midCheck = checkPartial(
    [pMid, tMid],
    ['ενδιάμεση πίεση', 'ενδιάμεση θερμοκρασία']
  );

  if (midCheck.isFull) {
    const pAbs       = pMid + P_ATM;
    const tSat       = satTempFromPressure(pMid);
    const midSh      = tMid - tSat;
    const ev         = evaluateMidSuperheat(midSh);

    renderResultCard('result-mid', {
      title:  'Ενδιάμεση βαθμίδα',
      status: ev.status,
      tag:    ev.tag,
      metrics: [
        { label: 'Πίεση gauge',          value: fmt(pMid, 2),    unit: 'bar' },
        { label: 'Θερμ. κορεσμού',       value: fmt(tSat, 1),    unit: '°C' },
        { label: 'Ενδιάμεση θερμ.',      value: fmt(tMid, 1),    unit: '°C' },
        { label: 'Ενδιάμ. superheat',    value: fmt(midSh, 1),   unit: '°C' },
      ],
      message: ev.message,
      causes:  ev.causes,
    });

    evaluated.push('ενδιάμεση βαθμίδα');
    if (ev.status !== 'ok') {
      issues.push({ status: ev.status, tag: ev.tag, message: ev.message });
    }
  } else if (midCheck.isPartial) {
    renderResultCard('result-mid', {
      title: 'Ενδιάμεση βαθμίδα',
      status: 'info',
      tag: null,
      metrics: [],
      message: 'Συμπληρώστε ακόμη: ' + midCheck.missing.join(', ') + '.',
      causes: [],
    });
    notEvaluated.push('ενδιάμεση βαθμίδα');
  } else {
    clearResultCard('result-mid');
    notEvaluated.push('ενδιάμεση βαθμίδα');
  }

  // ----- 5.5 Κατάθλιψη συμπιεστή --------------------------------------
  if (tDis !== null) {
    const ev = evaluateDischarge(tDis, mode);

    renderResultCard('result-discharge', {
      title:  'Κατάθλιψη συμπιεστή',
      status: ev.status,
      tag:    ev.tag,
      metrics: [
        { label: 'Θερμοκρασία κατάθλιψης', value: fmt(tDis, 1), unit: '°C' },
      ],
      message: ev.message,
      causes:  ev.causes,
    });

    evaluated.push('κατάθλιψη');
    if (ev.status !== 'ok') {
      issues.push({ status: ev.status, tag: ev.tag, message: ev.message });
    }
  } else {
    clearResultCard('result-discharge');
    notEvaluated.push('κατάθλιψη');
  }

  // Οι σχέσεις συμπίεσης αφαιρέθηκαν για Lyophilizer mode.

// ----- 5.7 Τελική διάγνωση -----------------------------------------
  renderDiagnosis(issues, evaluated, notEvaluated);

  // Εμφάνιση του section αποτελεσμάτων
  const resultsEl = document.getElementById('results');
  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


/**
 * Ενημερώνει την ένδειξη mode στην κορυφή των αποτελεσμάτων.
 */
function updateModeIndicator(mode) {
  const el = document.getElementById('mode-indicator');
  if (!el) return;
  el.textContent = 'Mode: ' + LIMITS[mode].label;
  el.classList.toggle('is-ult', mode === 'ult');
}


/**
 * Δημιουργεί το HTML περιεχόμενο μιας κάρτας αποτελέσματος.
 *   data: { title, status, tag, metrics, message, causes }
 */
function renderResultCard(elId, data) {
  const el = document.getElementById(elId);
  if (!el) return;

  // Καθαρισμός προηγούμενων κλάσεων κατάστασης
  el.classList.remove('is-ok', 'is-warn', 'is-danger', 'is-info');
  el.classList.add('is-' + data.status);

  // Tag (ετικέτα διάγνωσης) δίπλα στον τίτλο
  const tagHtml = data.tag
    ? `<span class="diag-tag is-${data.status}">${data.tag}</span>`
    : '';

  // Λίστα μετρήσεων
  let metricsHtml = '';
  if (data.metrics && data.metrics.length > 0) {
    metricsHtml = '<ul class="metrics">' + data.metrics.map(m => `
      <li>
        <span class="metric__label">${m.label}</span>
        <span class="metric__value">${m.value}<span class="unit">${m.unit}</span></span>
      </li>
    `).join('') + '</ul>';
  }

  // Πιθανές αιτίες (μόνο αν warn ή danger και υπάρχουν causes)
  let causesHtml = '';
  if (data.causes && data.causes.length > 0) {
    causesHtml = `
      <div class="causes">
        <p class="causes__title">🔎 Πιθανές αιτίες</p>
        <ul class="causes__list">
          ${data.causes.map(c => `<li>${c}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  el.innerHTML = `
    <header class="result-card__header">
      <h3 class="result-card__title">
        <span class="status-dot"></span>${data.title}
      </h3>
      ${tagHtml}
    </header>
    ${metricsHtml}
    <p class="result-card__message">${data.message}</p>
    ${causesHtml}
  `;
  el.hidden = false;
}


/**
 * Εξειδικευμένη κάρτα για τις σχέσεις συμπίεσης.
 */
function renderRatiosCard(elId, data) {
  const el = document.getElementById(elId);
  if (!el) return;

  el.classList.remove('is-ok', 'is-warn', 'is-danger', 'is-info');
  el.classList.add('is-' + data.status);

  const { pLowAbs, pMidAbs, pHighAbs } = data.absPressures;
  const { pLow,    pMid,    pHigh    } = data.gaugePressures;

  // Tag
  const tagHtml = data.tag
    ? `<span class="diag-tag is-${data.status}">${data.tag}</span>`
    : '';

  // Causes
  let causesHtml = '';
  if (data.causes && data.causes.length > 0) {
    causesHtml = `
      <div class="causes">
        <p class="causes__title">🔎 Πιθανές αιτίες</p>
        <ul class="causes__list">
          ${data.causes.map(c => `<li>${c}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  el.innerHTML = `
    <header class="result-card__header">
      <h3 class="result-card__title">
        <span class="status-dot"></span>${data.title}
      </h3>
      ${tagHtml}
    </header>

    <ul class="metrics" style="margin-bottom:14px;">
      <li>
        <span class="metric__label">P χαμηλής (gauge → abs)</span>
        <span class="metric__value">${fmt(pLow, 2)} → ${fmt(pLowAbs, 2)}<span class="unit">bar</span></span>
      </li>
      <li>
        <span class="metric__label">P ενδιάμεσης (gauge → abs)</span>
        <span class="metric__value">${fmt(pMid, 2)} → ${fmt(pMidAbs, 2)}<span class="unit">bar</span></span>
      </li>
      <li>
        <span class="metric__label">P υψηλής (gauge → abs)</span>
        <span class="metric__value">${fmt(pHigh, 2)} → ${fmt(pHighAbs, 2)}<span class="unit">bar</span></span>
      </li>
    </ul>

    <div class="ratios-grid">
      ${data.ratios.map(r => `
        <div class="ratio-item">
          <div class="ratio-item__label">${r.label}</div>
          <div class="ratio-item__value">
            ${fmt(r.value, 2)}<span class="ratio-unit"> : 1</span>
            <span class="badge is-${r.ev.status}">${r.ev.label}</span>
          </div>
        </div>
      `).join('')}
    </div>

    <p class="result-card__message">
      Απόλυτη πίεση = πίεση μανόμετρου + 1,013 bar. Οι σχέσεις συμπίεσης
      υπολογίζονται από τις απόλυτες πιέσεις.
    </p>
    ${causesHtml}
  `;
  el.hidden = false;
}


/**
 * Καθαρίζει μια κάρτα όταν δεν έχουμε δεδομένα.
 */
function clearResultCard(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = '';
  el.hidden = true;
  el.classList.remove('is-ok', 'is-warn', 'is-danger', 'is-info');
}


/**
 * Τελική διάγνωση: συνδυάζει όλα τα issues + πληροφορία για ελλείπουσες ενότητες.
 */
function renderDiagnosis(issues, evaluated, notEvaluated) {
  const el = document.getElementById('diagnosis');
  if (!el) return;

  el.classList.remove('is-ok', 'is-warn', 'is-danger');
  el.innerHTML = '';

  // Αν δεν αξιολογήθηκε καμία ενότητα
  if (evaluated.length === 0) {
    el.classList.add('is-warn');
    el.innerHTML = `
      <div class="diagnosis__icon">ℹ️</div>
      <div class="diagnosis__body">
        <p class="diagnosis__title">Δεν αξιολογήθηκε καμία ενότητα</p>
        <p class="diagnosis__text">
          Συμπληρώστε πλήρως τα πεδία τουλάχιστον μιας ενότητας
          (πίεση και θερμοκρασία μαζί) για να γίνει υπολογισμός.
        </p>
      </div>
    `;
    return;
  }

  // Καθορισμός συνολικής κατάστασης
  const overall = worstStatus(issues.map(i => i.status));

  let icon, title, mainText;

  if (overall === 'ok') {
    icon  = '✅';
    title = 'Αποτέλεσμα διάγνωσης';
    if (notEvaluated.length > 0) {
      mainText = 'Όσες μετρήσεις δόθηκαν βρίσκονται εντός τυπικών ορίων. ' +
                 'Με βάση τα διαθέσιμα δεδομένα, η λειτουργία φαίνεται καλή.';
    } else {
      mainText = 'Η λειτουργία φαίνεται καλή. Όλες οι μετρήσεις βρίσκονται ' +
                 'εντός τυπικών ορίων.';
    }
  } else if (overall === 'warn') {
    icon  = '⚠️';
    title = 'Προσοχή';
    const warns = issues.filter(i => i.status === 'warn').map(i => i.message);
    mainText = warns.join(' ');
  } else {
    icon  = '❌';
    title = 'Κίνδυνος';
    const dangers = issues.filter(i => i.status === 'danger').map(i => i.message);
    const warns   = issues.filter(i => i.status === 'warn').map(i => i.message);
    mainText = [...dangers, ...warns].join(' ');
  }

  // Συγκεντρωτικά tags των κύριων διαγνώσεων (unique)
  let tagsHtml = '';
  if (issues.length > 0) {
    const uniqueTags = [...new Set(issues.map(i => i.tag).filter(Boolean))];
    if (uniqueTags.length > 0) {
      tagsHtml = `
        <div class="diagnosis__tags">
          ${uniqueTags.map(t => {
            // Βρίσκουμε το χειρότερο status για κάθε tag
            const status = worstStatus(
              issues.filter(i => i.tag === t).map(i => i.status)
            );
            return `<span class="diag-tag is-${status}">${t}</span>`;
          }).join('')}
        </div>
      `;
    }
  }

  // Προαιρετική γραμμή για ενότητες που δεν αξιολογήθηκαν
  let missingNote = '';
  if (notEvaluated.length > 0) {
    missingNote = `
      <p class="diagnosis__missing">
        <strong>Δεν αξιολογήθηκαν:</strong> ${notEvaluated.join(', ')}.
        Για πλήρη διάγνωση συμπληρώστε και αυτές τις ενότητες.
      </p>
    `;
  }

  el.classList.add('is-' + overall);
  el.innerHTML = `
    <div class="diagnosis__icon">${icon}</div>
    <div class="diagnosis__body">
      <p class="diagnosis__title">${title}</p>
      <p class="diagnosis__text">${mainText}</p>
      ${tagsHtml}
      ${missingNote}
    </div>
  `;
}


/**
 * Καθαρίζει όλα τα πεδία της φόρμας και αποκρύπτει τα αποτελέσματα.
 */
function clearForm() {
  const ids = ['p-low', 't-low', 'p-high', 't-liquid', 'p-mid', 't-mid', 't-discharge'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Κρύβουμε κάρτες αποτελεσμάτων
  document.querySelectorAll('.result-card').forEach(c => {
    c.innerHTML = '';
    c.hidden = true;
    c.classList.remove('is-ok', 'is-warn', 'is-danger', 'is-info');
  });

  const resultsEl = document.getElementById('results');
  if (resultsEl) resultsEl.hidden = true;

  const first = document.getElementById('p-low');
  if (first) first.focus();
}


/* --------------------------------------------------------------------------
   6) ΣΥΝΔΕΣΗ ΜΕ ΚΟΥΜΠΙΑ (Event listeners)
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const btnCalc  = document.getElementById('btn-calculate');
  const btnClear = document.getElementById('btn-clear');

  if (btnCalc)  btnCalc.addEventListener('click',  calculate);
  if (btnClear) btnClear.addEventListener('click', clearForm);

  // Enter μέσα σε οποιοδήποτε input → υπολογισμός
  document.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        calculate();
      }
    });
  });

});
