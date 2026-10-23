// THIRD-PARTY CODE, NOT COVERED BY THIS MODULE'S LICENSE.
// The two exported strings below are copied verbatim (minus one level of indentation) from the Tormenta20 system
// for Foundry VTT 1.6.5 (https://gitlab.com/vizael/Tormenta20, file tormenta20.mjs), and are used only as test
// references. They are distributed under the system's BSD 3-Clause License, reproduced in full:
//
// BSD 3-Clause License
//
// Copyright (c) 2021, Victor Hugo Paiva
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this
//    list of conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice,
//    this list of conditions and the following disclaimer in the documentation
//    and/or other materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its
//    contributors may be used to endorse or promote products derived from
//    this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
// FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
// OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

// ItemT20#getAttackToHit and ItemT20#rollDamage from tormenta20 1.6.5 (tormenta20.mjs, T20:8148-8232 and
// T20:9108-9184), as Function.prototype.toString returns them (minus one level of indentation).
export const ATTACK_1_6_5 = `getAttackToHit() {
	const itemData = this.system;
	const rollData = this.getRollData();
	const roll = itemData.rolls.find((r) => r.type === "ataque");
	if (!this.hasAttack || !itemData || roll.parts.length < 2) return;
	// Define Roll bonuses
	const parts = roll.parts.map((p) => p[0] ?? p); // ;

	// Take no further action for un-owned items
	if (!this.isOwned) return { rollData, parts };
	const actorData = this.actor.system;
	const flags = this.actor.flags.tormenta20 || {};

	// Add skill bonus
	if (roll.parts[1][0]) {
		parts[1] = "@skill";
		if (!foundry.utils.isEmpty(actorData.pericias)) {
			rollData.skill = actorData.pericias[roll.parts[1][0]].value || 0;
		}
		// Change Skill Ability modifier
		let atributo = roll.parts[1][1];
		if (!atributo) {
			const { empunhadura, proposito } = this.system;
			const { for: forca, des } = actorData.atributos;
			const usarAcuidade =
				(game.settings.get("tormenta20", "lightFinesseWeapons") || flags?.acuidade) && des.value > forca.value;
			switch (proposito) {
				case "arremesso":
					if (flags?.arremessoPotente) atributo = "for";
					break;
				case "disparo":
					break;
				case "corpo-a-corpo":
				case "corpo-a-corpo-arremesso":
				default: {
					if (usarAcuidade && empunhadura === "leve") atributo = "des";
				}
			}
		}
		if (atributo) {
			const skill = actorData.pericias[roll.parts[1][0]];
			const abls = actorData.atributos;
			rollData.skill = skill.value - abls[skill.atributo].value + abls[atributo].value;
		}
	}

	// Item modifications and enchantments TODO
	// const mods = itemData.modificacoes;
	// if( mods?.pungente ) parts.push(2);
	// else if( mods?.certeira ) parts.push(1);
	// const enchants = itemData.encantos;
	// if( enchants?.magnifica || enchants.energetica ) parts.push(4);
	// else if( enchants?.formidavel ) parts.push(2);

	// Actor-level global bonus to attack rolls
	const bonuses = this.actor.system.modificadores?.ataque || {};
	if (bonuses.geral) parts.push(...bonuses.geral);
	if (bonuses.cac && roll.parts[1][0] !== "pont") {
		parts.push(...bonuses.cac);
	}
	if (bonuses.ad && roll.parts[1][0] === "pont") {
		parts.push(...bonuses.ad);
	}

	// One-time bonus provided by consumed ammunition
	if (itemData.consume?.type === "ammo" && this.actor.items) {
		const ammoItemData = this.actor.items.get(itemData.consume.target)?.system;

		if (ammoItemData) {
			const ammoItemQuantity = ammoItemData.qtd;
			const ammoCanBeConsumed = ammoItemQuantity && ammoItemQuantity - (itemData.consume.amount ?? 0) >= 0;
			const ammoAtqBns = ammoItemData.atqBns;
			const ammoIsTypeConsumable = ammoItemData.type === "consumivel" && ammoItemData.subtipo === "ammo";
			if (ammoCanBeConsumed && ammoAtqBns && ammoIsTypeConsumable) {
				parts.push("@ammo");
				rollData.ammo = ammoAtqBns;
			}
		}
	}

	// Condense the resulting attack bonus formula into a simplified label
	parts.shift();
	// Update labels and return the prepared roll data
	return { rollData, parts };
}
`;

export const DAMAGE_1_6_5 = `async rollDamage({ critical = false, event = null, options = {} } = {}) {
	const itemData = this.system;
	const actorData = this.actor.system;
	const flags = this.actor.flags.tormenta20 || {};
	let pericia;
	let lancinante = false;
	options.type = "damage";
	if (this.type === "arma") {
		critical = itemData.rolled?.Ataque?._critical || false;
		pericia = itemData.rolls.find((i) => i.type === "ataque")?.parts[1][0];
		// lancinante = Object.values(itemData.upgrades)?.includes("lancinating");
		lancinante = this.effects.some((i) => i.system.identifier == "lancinating");
	}
	const recoveryTypes = new Set(["curatpv", "curapm", "curatpm"]);
	for (let r of itemData.rolls) {
		if (r.type !== "dano") continue;
		const isRecovery = r.parts.some((p) => recoveryTypes.has(p[1]));
		const isHealing = r.parts.some((p) => p[1] === "curapv");
		const perda = r.parts.some((p) => p[1] === "perda");
		const isSpell = this.type === "magia";
		const isAlchemical = this.type === "consumivel" && this.system.tipo === "alchemy";
		const parts = r.parts.map(([dano, tipo, extra]) => {
			if (["curatpv", "curapm", "curatpm", "perda"].includes(tipo)) {
				return [dano, tipo, extra];
			}
			if (dano === "padrao") {
				const { empunhadura, proposito } = this.system;
				const { for: forca, des } = actorData.atributos;
				const usarAcuidade =
					(game.settings.get("tormenta20", "lightFinesseWeapons") || flags?.acuidade) && des.value > forca.value;
				switch (proposito) {
					case "disparo":
						dano = flags?.estiloDisparo ? "@des" : "";
						break;
					case "arremesso":
						dano = usarAcuidade ? "@des" : "@for";
						break;
					case "corpo-a-corpo":
					case "corpo-a-corpo-arremesso":
					default:
						dano = usarAcuidade && empunhadura === "leve" ? "@des" : "@for";
				}
			}
			return [dano, tipo, extra];
		});
		if (isRecovery) ; else if (isHealing) {
			const bonuses = foundry.utils.getProperty(actorData, "modificadores.cura") || {};
			if (bonuses.geral?.filter(Boolean).length) parts.push(["@curaGeral", "", ""]);
			if (isSpell && bonuses.mag?.filter(Boolean).length) parts.push(["@curaMagica", "", ""]);
			else if (isAlchemical && bonuses.alq?.filter(Boolean).length) parts.push(["@curaALQ", "", ""]);
		} else if (!perda) {
			const bonuses = foundry.utils.getProperty(actorData, "modificadores.dano") || {};
			if (bonuses.geral?.filter(Boolean).length) parts.push(["@dano", "", ""]);

			if (pericia === "luta" && bonuses.cac?.filter(Boolean).length) parts.push(["@danoCAC", "", ""]);
			else if (pericia === "pont" && bonuses.ad?.filter(Boolean).length) parts.push(["@danoAD", "", ""]);

			if (isSpell && bonuses.mag?.filter(Boolean).length) parts.push(["@danoMagico", "", ""]);
			else if (isAlchemical && bonuses.mag?.filter(Boolean).length) parts.push(["@danoALQ", "", ""]);
		}

		itemData.rolled[r.name] = await damageRoll({
			rd: r.rd,
			actor: this.actor,
			critical: critical ?? false,
			criticalMultiplier: itemData.criticoX,
			lancinante,
			data: this.getRollData(),
			event,
			parts,
			title: this.name,
			flavor: this.name,
			...options
		});
	}
	// return result;
}
`;
