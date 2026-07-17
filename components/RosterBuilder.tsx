'use client';

// Interactive squad editor for the create-match form: type-and-enter to add
// players (each appears as a chip with their avatar), remove with ✕, reorder
// by drag or with arrow keys on a focused chip (batting order matters).

import { useRef, useState, type KeyboardEvent } from 'react';
import Avatar from '@/components/Avatar';

const MAX_PLAYERS = 11;
const MIN_PLAYERS = 2;

interface RosterBuilderProps {
  label: string; // "Team A" fallback when no name typed yet
  teamName: string;
  idPrefix: string;
  players: string[];
  onChange: (players: string[]) => void;
  /** The player who turns out for both sides — shown as a pinned chip and
   *  counted toward this squad's size, but managed by their own input. */
  commonName?: string | null;
}

export default function RosterBuilder({ label, teamName, idPrefix, players, onChange, commonName }: RosterBuilderProps) {
  const [draft, setDraft] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const common = commonName?.trim() || null;
  const squadSize = players.length + (common ? 1 : 0);
  const full = squadSize >= MAX_PLAYERS;
  const displayName = teamName.trim() || label;

  function add() {
    const name = draft.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (players.some((p) => p.toLowerCase() === name.toLowerCase())) {
      setInputError(`${name} is already in the squad`);
      return;
    }
    if (common && common.toLowerCase() === name.toLowerCase()) {
      setInputError(`${common} already plays for both sides`);
      return;
    }
    onChange([...players, name]);
    setDraft('');
    setInputError(null);
    inputRef.current?.focus();
  }

  function remove(index: number) {
    onChange(players.filter((_, i) => i !== index));
    setInputError(null);
  }

  function move(index: number, delta: -1 | 1) {
    const to = index + delta;
    if (to < 0 || to >= players.length) return;
    const next = [...players];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  }

  function onChipKeyDown(e: KeyboardEvent<HTMLLIElement>, index: number) {
    if (e.key === 'ArrowUp') { e.preventDefault(); move(index, -1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(index, 1); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); remove(index); }
  }

  function onDrop(target: number) {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from == null || from === target) return;
    const next = [...players];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved!);
    onChange(next);
  }

  return (
    <div className="roster">
      <div className="roster-head">
        <label className="field-label" htmlFor={`roster-input-${idPrefix}`}>
          {displayName} squad
        </label>
        <span className={`roster-count${squadSize >= MIN_PLAYERS ? ' ok' : ''}`} aria-live="polite">
          {squadSize} / {MAX_PLAYERS}
        </span>
      </div>

      <div className="roster-input-row">
        <input
          ref={inputRef}
          type="text"
          id={`roster-input-${idPrefix}`}
          placeholder={full ? 'Squad full' : 'Add a player and press Enter'}
          value={draft}
          disabled={full}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => { setDraft(e.target.value); setInputError(null); }}
          onKeyDown={onInputKeyDown}
        />
        <button
          type="button"
          className="btn roster-add"
          onClick={add}
          disabled={full || !draft.trim()}
        >
          Add
        </button>
      </div>

      {inputError ? (
        <p className="roster-error" role="alert">{inputError}</p>
      ) : (
        <p className="roster-hint">
          {squadSize === 0
            ? `At least ${MIN_PLAYERS} players — first in, first to bat.`
            : squadSize < MIN_PLAYERS
              ? 'One more player to go.'
              : 'Drag to set the batting order.'}
        </p>
      )}

      {(players.length > 0 || common) && (
        <ol className="roster-list">
          {players.map((p, i) => (
            <li
              key={`${p}:${i}`}
              className="roster-chip"
              tabIndex={0}
              draggable
              aria-label={`${p}, position ${i + 1} of ${players.length}. Arrow keys reorder, delete removes.`}
              onKeyDown={(e) => onChipKeyDown(e, i)}
              onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => { e.preventDefault(); onDrop(i); }}
              onDragEnd={() => { dragFrom.current = null; }}
            >
              <span className="roster-grip" aria-hidden="true">⋮⋮</span>
              <span className="roster-order" aria-hidden="true">{i + 1}</span>
              <Avatar name={p} role="batsman" small />
              <span className="roster-name">{p}</span>
              <button
                type="button"
                className="roster-x"
                aria-label={`Remove ${p}`}
                onClick={() => remove(i)}
              >
                ×
              </button>
            </li>
          ))}
          {common && (
            <li
              className="roster-chip roster-chip--common"
              aria-label={`${common}, plays for both sides. Bats last; managed by the common player field.`}
            >
              <span className="roster-grip" aria-hidden="true" style={{ visibility: 'hidden' }}>⋮⋮</span>
              <span className="roster-order" aria-hidden="true">{players.length + 1}</span>
              <Avatar name={common} role="batsman" small />
              <span className="roster-name">{common}</span>
              <span className="both-chip">both sides</span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
