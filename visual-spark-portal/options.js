/** Editable competition options. Degree programs can be updated here. */

const INSTITUTE = "COMSATS University Islamabad, Vehari Campus";

const EVENT = {
  title: "VSPARK",
  subtitle: "Prompt Engineering Competition — AI Video Generation Challenge",
  dateLabel: "December 10, 2025",
  campus: INSTITUTE,
  feePkr: 1000,
  teamSize: "1–2 members",
  durationMinutesDefault: 20,
};

const ID_PREFIX = "VS-";

/** FA23-BSE-062: FA|SP + 2-digit year + 2–4 letter program + 3-digit roll. */
const REG_NO_RE = /^(FA|SP)\d{2}-[A-Z]{2,4}-\d{3}$/;

const PROGRAMS = [
  { code: "BSE", label: "BS Software Engineering (BSE)" },
  { code: "BCS", label: "BS Computer Science (BCS)" },
  { code: "BSAI", label: "BS Artificial Intelligence (BSAI)" },
  { code: "BSSE", label: "BS Software Engineering / SE (BSSE)" },
  { code: "BSI", label: "BS Information Technology (BSI / BSIT)" },
  { code: "BEE", label: "BS Electrical Engineering (BEE)" },
  { code: "BCE", label: "BS Computer Engineering (BCE)" },
  { code: "BBA", label: "Bachelor of Business Administration (BBA)" },
  { code: "BAF", label: "BS Accounting & Finance (BAF)" },
  { code: "MSCS", label: "MS Computer Science (MSCS)" },
  { code: "MSE", label: "MS Software Engineering (MSE)" },
  { code: "MBA", label: "Master of Business Administration (MBA)" },
];

const PROGRAM_LABELS = Object.fromEntries(PROGRAMS.map((p) => [p.code, p.label]));

/** Full display name for a stored program code, e.g. BSE -> BS Software Engineering (BSE). */
function programLabel(code) {
  const key = String(code || "").toUpperCase();
  return PROGRAM_LABELS[key] || key;
}

const PAYMENT_METHODS = ["JazzCash", "Easypaisa", "Bank Transfer", "On-campus Desk"];

const RECEIPT_MAX_BYTES = 2 * 1024 * 1024;

const GOOGLE_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

const TIMEZONE = "Asia/Karachi";

const RULES = [
  "Team size is 1 or 2 members. The registration fee is PKR 1,000 per team.",
  "On competition day each team receives its own timed window (default 20 minutes) to create an original AI video.",
  "The brief, reference material and the organizer Drive folder are released only after you start your timer.",
  "Create the video during your window. Previously completed videos are not allowed.",
  "Submit a Google Drive link that contains your video and the prompts you used.",
  "Students may use their own laptops and AI tools (for example Runway, Kling, Pika, Sora, CapCut, ChatGPT, Gemini, Claude).",
  "Participants arrange their own tool accounts, credits and subscriptions.",
  "Do not copy another team's work, fabricate evidence, or include unauthorized or harmful content.",
  "Judges may inspect prompts and verify the work. Their decision is final.",
];

module.exports = {
  INSTITUTE,
  EVENT,
  ID_PREFIX,
  REG_NO_RE,
  PROGRAMS,
  PROGRAM_LABELS,
  programLabel,
  PAYMENT_METHODS,
  RECEIPT_MAX_BYTES,
  GOOGLE_DRIVE_HOSTS,
  TIMEZONE,
  RULES,
};
