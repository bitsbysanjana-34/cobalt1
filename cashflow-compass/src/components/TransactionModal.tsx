import { useEffect, useState } from "react";
import type { Direction, Transaction } from "../types";
import { useApp } from "../store";
import { categoriesFor, suggestCategory } from "../lib/categorize";
import { money } from "../lib/format";
import { Field, Modal, Segmented } from "./ui";

interface Draft {
  date: string;
  description: string;
  amount: string;
  direction: Direction;
  category: string;
}

export function TransactionModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Transaction | null;
}) {
  const { today, addTransaction, updateTransaction, notify, merchantMemory } = useApp();
  const [draft, setDraft] = useState<Draft>({
    date: today,
    description: "",
    amount: "",
    direction: "expense",
    category: "Groceries",
  });
  const [error, setError] = useState<string | null>(null);
  const [categoryTouched, setCategoryTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDraft({
        date: editing.date,
        description: editing.description,
        amount: String(editing.amount),
        direction: editing.direction,
        category: editing.category,
      });
      setCategoryTouched(true);
    } else {
      setDraft({
        date: today,
        description: "",
        amount: "",
        direction: "expense",
        category: "Groceries",
      });
      setCategoryTouched(false);
    }
    setError(null);
  }, [open, editing, today]);

  const updateDescription = (value: string) => {
    setDraft((prev) => {
      const next = { ...prev, description: value };
      if (!categoryTouched && value.trim().length > 2) {
        next.category = suggestCategory(value, prev.direction, merchantMemory);
      }
      return next;
    });
  };

  const updateDirection = (value: string) => {
    const direction = value as Direction;
    setDraft((prev) => {
      const options = categoriesFor(direction);
      let category = prev.category;
      if (!(options as readonly string[]).includes(category)) {
        category = direction === "income" ? "Salary" : "Other";
      }
      if (!categoryTouched && prev.description.trim().length > 2) {
        category = suggestCategory(prev.description, direction, merchantMemory);
      }
      return { ...prev, direction, category };
    });
  };

  const submit = () => {
    const amount = Number(draft.amount);
    if (!draft.date) return setError("Choose a date.");
    if (draft.description.trim().length < 2) {
      return setError("Add a short description, such as the merchant or source.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return setError("Enter an amount greater than zero.");
    }
    if (draft.date > today) {
      return setError("This date is in the future. Add the transaction once it happens.");
    }
    const payload = {
      date: draft.date,
      description: draft.description.trim(),
      amount: Math.round(amount),
      direction: draft.direction,
      category: draft.category,
    };
    if (editing) {
      updateTransaction(editing.id, payload);
      notify("Transaction updated. Forecast recalculated.");
    } else {
      addTransaction(payload);
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit transaction" : "Add transaction"}
      subtitle="Manual entries stay on this device and feed the forecast immediately."
      footer={
        <>
          <div className="spacer" />
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {editing ? "Save changes" : "Add transaction"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Date" htmlFor="tx-date">
          <input
            id="tx-date"
            type="date"
            value={draft.date}
            max={today}
            onChange={(event) => setDraft({ ...draft, date: event.target.value })}
          />
        </Field>
        <Field label="Type">
          <Segmented
            label="Transaction type"
            value={draft.direction}
            onChange={updateDirection}
            options={[
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
          />
        </Field>
        <div className="form-span-2">
          <Field
            label="Description"
            hint="Category is suggested from the merchant name. You can change it below."
            htmlFor="tx-description"
          >
            <input
              id="tx-description"
              type="text"
              value={draft.description}
              placeholder="e.g. BigBasket Order"
              onChange={(event) => updateDescription(event.target.value)}
              autoFocus
            />
          </Field>
        </div>
        <Field label="Amount (₹)" htmlFor="tx-amount">
          <input
            id="tx-amount"
            type="number"
            min={1}
            step={1}
            value={draft.amount}
            placeholder="0"
            onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
          />
        </Field>
        <Field label="Category" htmlFor="tx-category">
          <select
            id="tx-category"
            value={draft.category}
            onChange={(event) => {
              setCategoryTouched(true);
              setDraft({ ...draft, category: event.target.value });
            }}
          >
            {categoriesFor(draft.direction).map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {draft.amount && Number(draft.amount) > 0 && (
        <p className="preview-amount">
          {draft.direction === "expense" ? "Expense" : "Income"} of{" "}
          <strong>{money(Number(draft.amount))}</strong> on {draft.date || "—"}
        </p>
      )}
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
