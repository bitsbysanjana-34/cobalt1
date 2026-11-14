import { useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import {
  buildSampleCsv,
  downloadText,
  parseCsv,
  previewRowsToTransactions,
} from "../lib/csv";
import { money, shortDate } from "../lib/format";
import { Icon } from "./Icon";
import { Badge, Field, Modal, Segmented } from "./ui";

export function CsvImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { transactions, merchantMemory, importTransactions, notify, today } = useApp();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [positiveMeansExpense, setPositiveMeansExpense] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(
    () => (text ? parseCsv(text, transactions, positiveMeansExpense) : null),
    [text, transactions, positiveMeansExpense],
  );

  const readyRows = parsed
    ? parsed.rows.filter((row) => !row.error && !row.duplicate)
    : [];
  const invalidRows = parsed ? parsed.rows.filter((row) => row.error) : [];
  const duplicateRows = parsed ? parsed.rows.filter((row) => row.duplicate && !row.error) : [];
  const ambiguous =
    parsed !== null && !parsed.hasTypeColumn && !parsed.hasExplicitSigns && parsed.rows.length > 0;

  const reset = () => {
    setText("");
    setFileName("");
    setFileError(null);
    setDragging(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    onClose();
    reset();
  };

  const readFile = async (file: File) => {
    setFileError(null);
    if (!/\.csv$|\.txt$/i.test(file.name)) {
      setFileError("Choose a .csv file (or a plain-text file with comma-separated rows).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError("That file is larger than 5 MB. Split it into smaller files.");
      return;
    }
    try {
      const content = await file.text();
      if (!content.trim()) {
        setFileError("The file is empty.");
        return;
      }
      setText(content);
      setFileName(file.name);
    } catch {
      setFileError("The file could not be read. Try exporting it again as CSV.");
    }
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void readFile(file);
  };

  const handleImport = () => {
    if (!parsed || readyRows.length === 0) return;
    const rows = previewRowsToTransactions(parsed.rows, merchantMemory);
    const count = importTransactions(rows);
    notify(`${count} transaction${count === 1 ? "" : "s"} imported. Forecast updated.`);
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import transactions"
      subtitle="Parsed and stored entirely in your browser. Nothing is uploaded."
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={reset} disabled={!text}>
            Choose another file
          </button>
          <div className="spacer" />
          <button className="btn btn-secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={readyRows.length === 0 || !parsed || parsed.errors.length > 0}
          >
            <Icon name="upload" size={16} />
            Import {readyRows.length > 0 ? `${readyRows.length} transaction${readyRows.length === 1 ? "" : "s"}` : "transactions"}
          </button>
        </>
      }
    >
      {!text && (
        <div className="import-start">
          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
            }}
          >
            <div className="dropzone-icon">
              <Icon name="upload" size={24} />
            </div>
            <h3>Drop a CSV file here</h3>
            <p>or click to browse · up to 5 MB</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.txt,text/csv"
              hidden
              onChange={(event) => handleFiles(event.target.files)}
            />
          </div>
          {fileError && (
            <div className="inline-error">
              <Icon name="alert" size={16} /> {fileError}
            </div>
          )}
          <div className="import-help">
            <div>
              <h4>Expected columns</h4>
              <p>
                <code>date</code>, <code>description</code>, <code>amount</code> are required.
                Optional: <code>category</code>, <code>type</code> (income/expense), or separate{" "}
                <code>debit</code>/<code>credit</code> columns.
              </p>
            </div>
            <div>
              <h4>Try the format</h4>
              <p>Download a ready-to-import sample built around your current date.</p>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => downloadText("cashflow-compass-sample.csv", buildSampleCsv(today))}
              >
                <Icon name="download" size={15} /> Download sample CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {text && parsed && (
        <div className="import-preview">
          <div className="preview-head">
            <div className="file-chip">
              <Icon name="list" size={16} />
              <span>{fileName || "pasted data"}</span>
              <span className="subtle">{parsed.rows.length} rows</span>
            </div>
            <div className="preview-counts">
              <Badge tone="good" dot>
                {readyRows.length} ready
              </Badge>
              {invalidRows.length > 0 && (
                <Badge tone="expense" dot>
                  {invalidRows.length} with errors
                </Badge>
              )}
              {duplicateRows.length > 0 && (
                <Badge tone="warn" dot>
                  {duplicateRows.length} duplicate{duplicateRows.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          </div>

          <div className="mapping-row">
            {(["date", "description", "amount", "category", "type"] as const).map((field) =>
              parsed.mapping[field] ? (
                <span className="mapping-chip" key={field}>
                  <span className="subtle">{field}</span> → {parsed.mapping[field]}
                </span>
              ) : null,
            )}
            {parsed.mapping.credit && (
              <span className="mapping-chip">
                <span className="subtle">credit</span> → {parsed.mapping.credit}
              </span>
            )}
            {parsed.mapping.debit && (
              <span className="mapping-chip">
                <span className="subtle">debit</span> → {parsed.mapping.debit}
              </span>
            )}
          </div>

          {ambiguous && (
            <div className="notice notice-info">
              <Icon name="info" size={16} />
              <div>
                <strong>No type column and no +/- signs found.</strong>
                <div className="notice-row">
                  <span>Treat positive amounts as</span>
                  <Segmented
                    size="sm"
                    label="Positive amount meaning"
                    value={positiveMeansExpense ? "expense" : "income"}
                    onChange={(value) => setPositiveMeansExpense(value === "expense")}
                    options={[
                      { value: "expense", label: "Expense" },
                      { value: "income", label: "Income" },
                    ]}
                  />
                </div>
                <p className="subtle">Rows with an income category such as Salary stay income.</p>
              </div>
            </div>
          )}

          {parsed.errors.length > 0 && (
            <div className="notice notice-error">
              <Icon name="alert" size={16} />
              <div>
                <strong>This file cannot be imported yet</strong>
                <ul>
                  {parsed.errors.map((error) => (
                    <li key={error.message}>{error.message}</li>
                  ))}
                </ul>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => downloadText("cashflow-compass-sample.csv", buildSampleCsv(today))}
                >
                  Download a correct sample
                </button>
              </div>
            </div>
          )}

          {invalidRows.length > 0 && (
            <div className="notice notice-warn">
              <Icon name="alert" size={16} />
              <div>
                <strong>{invalidRows.length} row{invalidRows.length === 1 ? "" : "s"} will be skipped</strong>
                <ul>
                  {invalidRows.slice(0, 5).map((row) => (
                    <li key={row.index}>
                      Row {row.index}: {row.error}
                    </li>
                  ))}
                  {invalidRows.length > 5 && <li>…and {invalidRows.length - 5} more.</li>}
                </ul>
              </div>
            </div>
          )}

          <div className="table-scroll">
            <table className="data-table preview-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th className="right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 8).map((row) => (
                  <tr key={row.index} className={row.error ? "row-error" : ""}>
                    <td className="subtle">{row.index}</td>
                    <td>{row.date ? shortDate(row.date) : "—"}</td>
                    <td className="cell-description">{row.description || "—"}</td>
                    <td>
                      {row.category ? (
                        row.category
                      ) : row.description ? (
                        <Badge tone="info">auto</Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className={`amount ${row.direction}`}>
                        {row.direction === "income" ? "Income" : "Expense"}
                      </span>
                    </td>
                    <td className="right num">{row.amount !== null ? money(row.amount) : "—"}</td>
                    <td>
                      {row.error ? (
                        <span className="status-error">{row.error}</span>
                      ) : row.duplicate ? (
                        <Badge tone="warn">Duplicate · skip</Badge>
                      ) : row.warning ? (
                        <Badge tone="warn">Check</Badge>
                      ) : (
                        <Badge tone="good">Ready</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > 8 && (
            <p className="subtle preview-more">
              Previewing the first 8 of {parsed.rows.length} rows. All valid rows will be imported.
            </p>
          )}
          <Field label="Date format">
            <p className="subtle small">
              ISO dates are read as-is. Slashed dates are read day-first (DD/MM/YYYY) unless the
              month is unambiguous. “12 Nov 2026” style is also accepted.
            </p>
          </Field>
        </div>
      )}
    </Modal>
  );
}
