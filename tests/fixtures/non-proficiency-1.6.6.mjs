// THIRD-PARTY CODE, NOT COVERED BY THIS MODULE'S LICENSE.
// The method below is copied verbatim from the Tormenta20 system for Foundry VTT 1.6.6
// (https://gitlab.com/vizael/Tormenta20, file tormenta20.mjs, ItemT20#getAttackToHit, T20:6972-7060), and is used
// only as a test reference. It is distributed under the system's BSD 3-Clause License, reproduced in full:
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

/* eslint-disable */
export class Item166 {
	getAttackToHit() {
		const itemData = this.system;
		const rollData = this.getRollData();
		const roll = itemData.rolls.find((r) => r.type === "ataque");
		if (!this.hasAttack || !itemData || roll.parts.length < 2) return;
		// Define Roll bonuses
		const parts = roll.parts.map((p) => p[0] ?? p); // ;

		// Take no further action for un-owned items
		if (!this.isOwned) return { rollData, parts };
		const actorData = this.actor.system;
		// FLAGS
		const hasFinesse =
			game.settings.get("tormenta20", "lightFinesseWeapons") || this.actor.getFlag("tormenta20", "acuidade");
		const hasPotentThrow = this.actor.getFlag("tormenta20", "arremessoPotente");

		// Add skill bonus
		if (roll.parts[1][0]) {
			parts[1] = "@skill";
			if (!foundry.utils.isEmpty(actorData.pericias)) {
				rollData.skill = actorData.pericias[roll.parts[1][0]].value || 0;
			}
			// Change Skill Ability modifier
			let atributo = roll.parts[1][1];
			if (!atributo) {
				const { empunhadura, proposito, propriedades } = this.system;
				const { for: forca, des } = actorData.atributos;
				const isFinesse = empunhadura == "leve" || propriedades.agi;
				const usarAcuidade = isFinesse && hasFinesse && des.value > forca.value;

				switch (proposito) {
					case "arremesso":
						if (hasPotentThrow) atributo = "for";
						break;
					case "disparo":
						break;
					case "corpo-a-corpo":
					case "corpo-a-corpo-arremesso":
					default: {
						if (usarAcuidade) atributo = "des";
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
}
