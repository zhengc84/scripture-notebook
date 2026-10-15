// [name, bible-api.com id, chapter count, ESV query name]
window.BOOKS = [
  ['Genesis','GEN',50],['Exodus','EXO',40],['Leviticus','LEV',27],['Numbers','NUM',36],
  ['Deuteronomy','DEU',34],['Joshua','JOS',24],['Judges','JDG',21],['Ruth','RUT',4],
  ['1 Samuel','1SA',31],['2 Samuel','2SA',24],['1 Kings','1KI',22],['2 Kings','2KI',25],
  ['1 Chronicles','1CH',29],['2 Chronicles','2CH',36],['Ezra','EZR',10],['Nehemiah','NEH',13],
  ['Esther','EST',10],['Job','JOB',42],['Psalms','PSA',150,'Psalm'],['Proverbs','PRO',31],
  ['Ecclesiastes','ECC',12],['Song of Solomon','SNG',8],['Isaiah','ISA',66],['Jeremiah','JER',52],
  ['Lamentations','LAM',5],['Ezekiel','EZK',48],['Daniel','DAN',12],['Hosea','HOS',14],
  ['Joel','JOL',3],['Amos','AMO',9],['Obadiah','OBA',1],['Jonah','JON',4],['Micah','MIC',7],
  ['Nahum','NAM',3],['Habakkuk','HAB',3],['Zephaniah','ZEP',3],['Haggai','HAG',2],
  ['Zechariah','ZEC',14],['Malachi','MAL',4],
  ['Matthew','MAT',28],['Mark','MRK',16],['Luke','LUK',24],['John','JHN',21],['Acts','ACT',28],
  ['Romans','ROM',16],['1 Corinthians','1CO',16],['2 Corinthians','2CO',13],['Galatians','GAL',6],
  ['Ephesians','EPH',6],['Philippians','PHP',4],['Colossians','COL',4],['1 Thessalonians','1TH',5],
  ['2 Thessalonians','2TH',3],['1 Timothy','1TI',6],['2 Timothy','2TI',4],['Titus','TIT',3],
  ['Philemon','PHM',1],['Hebrews','HEB',13],['James','JAS',5],['1 Peter','1PE',5],['2 Peter','2PE',3],
  ['1 John','1JN',5],['2 John','2JN',1],['3 John','3JN',1],['Jude','JUD',1],['Revelation','REV',22],
].map(([name, id, chapters, esvName], i) => ({ name, id, chapters, esvName: esvName || name, index: i, testament: i < 39 ? 'OT' : 'NT' }));

// Common abbreviations for the "Go to" box.
window.BOOK_ALIASES = {
  gen:'Genesis', ex:'Exodus', exo:'Exodus', lev:'Leviticus', num:'Numbers', deut:'Deuteronomy', dt:'Deuteronomy',
  josh:'Joshua', judg:'Judges', jdg:'Judges', ps:'Psalms', psa:'Psalms', psalm:'Psalms', prov:'Proverbs', pr:'Proverbs',
  eccl:'Ecclesiastes', ecc:'Ecclesiastes', song:'Song of Solomon', sos:'Song of Solomon', songofsongs:'Song of Solomon',
  isa:'Isaiah', jer:'Jeremiah', lam:'Lamentations', ezek:'Ezekiel', dan:'Daniel', hos:'Hosea', obad:'Obadiah',
  mic:'Micah', nah:'Nahum', hab:'Habakkuk', zeph:'Zephaniah', hag:'Haggai', zech:'Zechariah', mal:'Malachi',
  mt:'Matthew', matt:'Matthew', mk:'Mark', mrk:'Mark', lk:'Luke', jn:'John', jhn:'John', rom:'Romans',
  '1cor':'1 Corinthians', '2cor':'2 Corinthians', gal:'Galatians', eph:'Ephesians', phil:'Philippians', php:'Philippians',
  col:'Colossians', '1thess':'1 Thessalonians', '2thess':'2 Thessalonians', '1tim':'1 Timothy', '2tim':'2 Timothy',
  phlm:'Philemon', philem:'Philemon', heb:'Hebrews', jas:'James', '1pet':'1 Peter', '2pet':'2 Peter',
  '1jn':'1 John', '2jn':'2 John', '3jn':'3 John', rev:'Revelation', revelations:'Revelation',
};
