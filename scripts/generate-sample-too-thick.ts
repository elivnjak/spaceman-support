import ExcelJS from "exceljs";
import path from "path";

const LIGHT_BLUE: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD6EAF8" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11 };

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  instruction: string,
  columns: { header: string; key: string; width: number }[],
  dataRows: Record<string, string>[],
) {
  const ws = wb.addWorksheet(name);

  ws.mergeCells(1, 1, 1, columns.length);
  const instrCell = ws.getCell(1, 1);
  instrCell.value = instruction;
  instrCell.fill = LIGHT_BLUE;
  instrCell.font = { size: 11 };
  instrCell.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(1).height = 40;

  columns.forEach((col, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = col.header;
    cell.font = HEADER_FONT;
  });

  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

  dataRows.forEach((row, ri) => {
    const excelRow = ws.getRow(3 + ri);
    columns.forEach((col, ci) => {
      excelRow.getCell(ci + 1).value = row[col.key] ?? "";
    });
  });

  return ws;
}

async function main() {
  const wb = new ExcelJS.Workbook();

  addSheet(
    wb,
    "Overview",
    "Fill in the playbook title and the label ID it belongs to.",
    [
      { header: "title", key: "title", width: 40 },
      { header: "label_id", key: "label_id", width: 30 },
    ],
    [{ title: "Fix too thick texture — Spaceman", label_id: "too_thick" }],
  );

  addSheet(
    wb,
    "Symptoms",
    "List the symptoms a user might describe that would trigger this playbook.",
    [
      { header: "id", key: "id", width: 25 },
      { header: "description", key: "description", width: 60 },
    ],
    [
      { id: "too_dense", description: "Product is overly dense or heavy" },
      { id: "too_stiff", description: "Product is stiff and hard to dispense" },
      { id: "wont_dispense", description: "Machine struggles to push product out" },
      { id: "crumbly", description: "Product breaks apart or is crumbly" },
      { id: "freezer_burn_look", description: "Product looks dry or freezer-burned" },
    ],
  );

  addSheet(
    wb,
    "Evidence",
    "Evidence the assistant should collect during diagnosis.",
    [
      { header: "id", key: "id", width: 25 },
      { header: "description", key: "description", width: 50 },
      { header: "type", key: "type", width: 18 },
      { header: "required", key: "required", width: 12 },
    ],
    [
      { id: "machine_model", description: "Machine model", type: "observation", required: "yes" },
      { id: "dispense_photo", description: "Photo of product dispense showing thickness", type: "photo", required: "yes" },
      { id: "hopper_temp", description: "Hopper temperature reading (normal range -8°C to -4°C; below this can cause thick product)", type: "reading", required: "yes" },
      { id: "cylinder_temp", description: "Cylinder temperature reading if available", type: "reading", required: "no" },
      { id: "mix_ratio", description: "Current mix-to-water ratio being used", type: "observation", required: "yes" },
      { id: "last_defrost", description: "When the machine was last defrosted", type: "observation", required: "no" },
      { id: "scraper_condition", description: "Condition of scraper blades", type: "action", required: "no" },
      { id: "overrun_level", description: "Air overrun / aeration level setting", type: "reading", required: "no" },
    ],
  );

  addSheet(
    wb,
    "Causes",
    "Possible root causes the assistant will try to narrow down.",
    [
      { header: "id", key: "id", width: 25 },
      { header: "cause", key: "cause", width: 55 },
      { header: "likelihood", key: "likelihood", width: 14 },
      { header: "ruling_evidence", key: "ruling_evidence", width: 40 },
    ],
    [
      { id: "hopper_too_cold", cause: "Hopper temperature too low — product is over-frozen", likelihood: "high", ruling_evidence: "hopper_temp" },
      { id: "too_much_mix", cause: "Too much mix concentrate relative to water", likelihood: "high", ruling_evidence: "mix_ratio" },
      { id: "low_overrun", cause: "Insufficient air incorporation (low overrun)", likelihood: "medium", ruling_evidence: "overrun_level" },
      { id: "ice_buildup", cause: "Ice buildup on cylinder walls from missed defrost", likelihood: "medium", ruling_evidence: "last_defrost, cylinder_temp" },
      { id: "worn_scrapers", cause: "Worn scraper blades not mixing product properly", likelihood: "medium", ruling_evidence: "scraper_condition" },
      { id: "low_usage", cause: "Product sitting too long without being pulled", likelihood: "low", ruling_evidence: "dispense_photo" },
    ],
  );

  addSheet(
    wb,
    "Questions",
    "Diagnostic questions the assistant can ask the user.",
    [
      { header: "id", key: "id", width: 25 },
      { header: "question", key: "question", width: 50 },
      { header: "purpose", key: "purpose", width: 40 },
      { header: "when_to_ask", key: "when_to_ask", width: 30 },
    ],
    [
      { id: "ask_temp", question: "What temperature does the hopper display show?", purpose: "Check if hopper is running too cold", when_to_ask: "Always ask first" },
      { id: "ask_mix", question: "What mix-to-water ratio are you using?", purpose: "Rule out incorrect mix concentration", when_to_ask: "After temperature check" },
      { id: "ask_defrost", question: "When was the last time the machine was defrosted?", purpose: "Check for ice buildup on cylinder", when_to_ask: "If temperature is in range but product still thick" },
      { id: "ask_usage", question: "How often is product being dispensed? Roughly how many servings per hour?", purpose: "Determine if product sits too long between pulls", when_to_ask: "If other causes ruled out" },
      { id: "ask_overrun", question: "What is the air pump or overrun setting on the machine?", purpose: "Check if aeration is too low", when_to_ask: "If mix ratio and temperature are normal" },
    ],
  );

  addSheet(
    wb,
    "Triggers",
    "Escalation triggers — if the user mentions one of these, escalate immediately.",
    [
      { header: "trigger", key: "trigger", width: 30 },
      { header: "reason", key: "reason", width: 50 },
    ],
    [
      { trigger: "electrical smell", reason: "Potential electrical hazard — needs on-site inspection" },
      { trigger: "refrigerant leak", reason: "Refrigerant handling requires certified technician" },
      { trigger: "error code", reason: "Machine error codes require technician diagnosis" },
      { trigger: "sparking", reason: "Electrical hazard — stop using machine immediately" },
      { trigger: "motor noise", reason: "Unusual motor sounds may indicate mechanical failure" },
    ],
  );

  addSheet(
    wb,
    "Steps",
    "Resolution steps the user should follow once a cause is identified. Row order = step order.",
    [
      { header: "title", key: "title", width: 30 },
      { header: "instruction", key: "instruction", width: 55 },
      { header: "check", key: "check", width: 35 },
      { header: "if_failed", key: "if_failed", width: 35 },
    ],
    [
      {
        title: "Raise hopper temperature",
        instruction: "Adjust the hopper thermostat up so the operating range is -8°C to -4°C. The product may be over-freezing if the setting is too low.",
        check: "Hopper display shows temperature within -8°C to -4°C after 15 minutes.",
        if_failed: "If temperature does not rise, check thermostat and escalate to technician.",
      },
      {
        title: "Correct mix ratio",
        instruction: "Verify the mix-to-water ratio matches the manufacturer's recommendation. Reduce concentrate if the ratio is too high.",
        check: "Mix ratio matches label instructions.",
        if_failed: "Discard current batch and prepare a new one with correct ratio.",
      },
      {
        title: "Defrost the machine",
        instruction: "Run a full defrost cycle according to the machine manual to clear any ice buildup on the cylinder walls.",
        check: "Defrost cycle completes and no ice visible inside cylinder.",
        if_failed: "If ice persists, escalate to technician — possible refrigeration valve issue.",
      },
      {
        title: "Check and adjust overrun",
        instruction: "Inspect the air pump and overrun setting. Increase aeration if the setting is below the recommended level for your mix type.",
        check: "Product dispensed with visible aeration and lighter texture.",
        if_failed: "If air pump is not working, escalate for pump inspection or replacement.",
      },
      {
        title: "Inspect scraper blades",
        instruction: "Remove and inspect scraper blades for wear. Replace if blades are worn, cracked, or no longer make full contact with the cylinder.",
        check: "New or intact blades installed, even contact with cylinder wall.",
        if_failed: "Order replacement blades; reduce usage until replaced.",
      },
      {
        title: "Pull product to refresh",
        instruction: "Dispense several servings to cycle fresh product through the cylinder. This clears over-frozen product that has been sitting.",
        check: "Dispensed product has improved texture and consistency.",
        if_failed: "Allow machine 20 minutes to re-freeze and try again.",
      },
    ],
  );

  const outPath = path.resolve(__dirname, "..", "data", "sample-too-thick-playbook.xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log(`Sample playbook written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
