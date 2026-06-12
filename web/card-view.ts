// Read-only "what does this card do" view: renders a Pokemon's stats, ability,
// and attacks (cost / damage / real effect text) for the editor panel.  Pure
// (takes a card, returns a node) so it is unit-testable without the whole app.
// All text goes through el()'s append(string) -> text node, so card strings can
// never be interpreted as HTML.
import { el } from './dom.js';
import type { Attack, Condition, EnergyType, PokemonCard, Stage } from '../src/types.js';

// Energy -> single-letter code matching the game's pips (R=Fire, L=Lightning...).
export const COST_ABBR: Record<EnergyType, string> = {
  Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P',
  Fighting: 'F', Darkness: 'D', Metal: 'M', Dragon: 'N', Colorless: 'C',
};

const STAGE_LABEL: Record<Stage, string> = { Basic: 'Basic', Stage1: 'Stage 1', Stage2: 'Stage 2' };

// Human label for an attack's headline number: a flat hit shows the number (with
// a "+" when it scales up), a per-heads coin attack shows "Nx", and an effect-
// only attack shows nothing (the effect text carries it).
export function dmgLabel(a: Attack): string {
  if (a.damage > 0) return `${a.damage}${a.variable ? '+' : ''}`;
  if (a.coin && a.coin.damagePerHeads > 0) return `${a.coin.damagePerHeads}x`;
  return '';
}

function costStr(cost: EnergyType[]): string {
  return cost.length ? cost.map((e) => COST_ABBR[e] ?? '?').join('') : '-';
}

const COND_TAG: Record<Condition, string> = {
  asleep: 'sleep', paralyzed: 'paralyze', poisoned: 'poison', burned: 'burn', confused: 'confuse',
};

// Compact chips for the engine-parsed mechanics of an attack, so a player sees
// the riders at a glance next to the prose effect text.
export function riderTags(a: Attack): { cls: string; label: string }[] {
  const tags: { cls: string; label: string }[] = [];
  if (a.coin?.flips) tags.push({ cls: 'coin', label: `coin x${a.coin.flips}` });
  if (a.coin?.successProbability != null) tags.push({ cls: 'coin', label: `${Math.round(a.coin.successProbability * 100)}% hit` });
  for (const c of a.inflicts ?? []) tags.push({ cls: 'cond', label: COND_TAG[c] });
  for (const c of a.coinInflict ?? []) tags.push({ cls: 'cond', label: `50% ${COND_TAG[c]}` });
  for (const d of a.discards ?? []) {
    const amt = d.amount === 'all' ? 'all' : String(d.amount);
    tags.push(d.target === 'self'
      ? { cls: 'disc', label: `discard ${amt}${d.type ? ` ${COST_ABBR[d.type]}` : ''}` }
      : { cls: 'strip', label: `strip ${amt} energy` });
  }
  if (a.heal) tags.push({ cls: 'heal', label: `heal ${a.heal.amount}${a.heal.scope === 'team' ? ' (team)' : ''}` });
  if (a.splash) {
    const where = a.splash.benchOnly ? ' bench' : '';
    tags.push({ cls: 'strip', label: a.splash.targets === 'all' ? `spread ${a.splash.amount}${where}` : `snipe ${a.splash.amount}${where}` });
  }
  return tags;
}

export function cardDetailEl(card: PokemonCard): HTMLElement {
  const box = el('div', { class: 'cardinfo' });
  box.append(el('div', { class: 'ci-meta' },
    `${card.type} - ${card.hp} HP - ${STAGE_LABEL[card.stage]}`
    + (card.evolvesFrom ? ` - from ${card.evolvesFrom}` : '')
    + (card.weakness ? ` - weak ${card.weakness}` : '')
    + ` - retreat ${card.retreatCost}`));
  if (card.ability) {
    box.append(el('div', { class: 'ci-ability' },
      el('span', { class: 'ci-abname' }, `Ability: ${card.ability.name}`),
      card.ability.text ? el('div', { class: 'ci-text' }, card.ability.text) : null));
  }
  for (const a of card.attacks) {
    const dl = dmgLabel(a);
    const tags = riderTags(a);
    box.append(el('div', { class: 'ci-attack' },
      el('div', { class: 'ci-ahead' },
        el('span', { class: 'ci-cost' }, costStr(a.cost)),
        el('span', { class: 'ci-aname' }, a.name),
        dl ? el('span', { class: 'ci-dmg' }, dl) : null),
      tags.length ? el('div', { class: 'ci-tags' }, ...tags.map((t) => el('span', { class: `ci-tag ${t.cls}` }, t.label))) : null,
      a.text ? el('div', { class: 'ci-text' }, a.text) : null));
  }
  return box;
}
