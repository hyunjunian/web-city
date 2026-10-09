// U-Drive-It: vehicles and the structures that make them
// available. Missions are in missions.ts. Training missions are taken as done.

import type { StructureKind } from './structures';

export type VehicleClass = 'land' | 'air' | 'water' | 'rail';

/** A vehicle needs one structure from each group (or a zone/population condition). */
export interface VehicleDef {
  name: string;
  class: VehicleClass;
  /** Each inner list is a choice: one of those structures must stand. */
  requires: readonly (readonly StructureKind[])[];
  /** Ice Cream Truck: any homes; Getaway Van: any shops; Garbage Truck: a landfill. */
  needs?: 'residential' | 'commercial' | 'landfill' | 'mySim1' | 'mySim2' | 'mySim3';
}

const POLICE = ['smallPoliceStation', 'largePoliceStation', 'deluxePoliceStation'] as const;
const FIRE = ['smallFireStation', 'largeFireStation', 'fireLandingStrip'] as const;
const STRIPS = ['smallLandingStrip', 'mediumLandingStrip', 'largeLandingStrip'] as const;
const AIRPORTS = [
  ...STRIPS, 'smallMunicipalAirport', 'mediumMunicipalAirport', 'largeMunicipalAirport',
  'smallInternationalAirport', 'mediumInternationalAirport', 'largeInternationalAirport',
] as const;

export const VEHICLES = {
  policeCar: { name: 'Police Car', class: 'land', requires: [POLICE] },
  policeVan: { name: 'Police Van', class: 'land', requires: [['largePoliceStation', 'deluxePoliceStation']] },
  fireEngine: { name: 'Fire Engine', class: 'land', requires: [FIRE] },
  ambulance: { name: 'Ambulance', class: 'land', requires: [['largeMedicalCenter']] },
  schoolBus: { name: 'School Bus', class: 'land', requires: [['elementarySchool', 'highSchool', 'largeElementarySchool', 'largeHighSchool']] },
  cityBus: { name: 'City Bus', class: 'land', requires: [['busStop']] },
  garbageTruck: { name: 'Garbage Truck', class: 'land', requires: [], needs: 'landfill' },
  toxicWasteTruck: { name: 'Toxic Waste Truck', class: 'land', requires: [['toxicWasteDump']] },
  taxiCab: { name: 'Taxi Cab', class: 'land', requires: [AIRPORTS] },
  mayorsLimo: { name: "Mayor's Limo", class: 'land', requires: [['mayorsHouse']] },
  armyTruck: { name: 'Army Truck', class: 'land', requires: [['armyBase']] },
  tank: { name: 'Tank', class: 'land', requires: [['armyBase']] },
  hearse: { name: 'Hearse', class: 'land', requires: [['cemetery']] },
  iceCreamTruck: { name: 'Ice Cream Truck', class: 'land', requires: [], needs: 'residential' },
  newsVan: { name: 'News Van', class: 'land', requires: [['televisionStudio']] },
  getawayVan: { name: 'Getaway Van', class: 'land', requires: [], needs: 'commercial' },
  mySimVehicle1: { name: '§ My Sim Vehicle', class: 'land', requires: [], needs: 'mySim1' },
  mySimVehicle2: { name: '§§ My Sim Vehicle', class: 'land', requires: [], needs: 'mySim2' },
  mySimVehicle3: { name: '§§§ My Sim Vehicle', class: 'land', requires: [], needs: 'mySim3' },
  freightTrain: { name: 'Freight Train', class: 'rail', requires: [['freightStation']] },
  steamTrain: { name: 'Steam Train', class: 'rail', requires: [['freightStation']] },
  passengerTrain: { name: 'Passenger Train', class: 'rail', requires: [['trainStation']] },
  monorailEngine: { name: 'Monorail Engine', class: 'rail', requires: [['monorailStation']] },
  motorBoat: { name: 'Motor Boat', class: 'water', requires: [['marina']] },
  speedBoat: { name: 'Speed Boat', class: 'water', requires: [['marina']] },
  cigarBoat: { name: 'Cigar Boat', class: 'water', requires: [['marina']] },
  fishingBoat: { name: 'Fishing Boat', class: 'water', requires: [['marina']] },
  tugBoat: { name: 'Tug Boat', class: 'water', requires: [['marina']] },
  yacht: { name: 'Yacht', class: 'water', requires: [['marina']] },
  ferryBoat: { name: 'Ferry Boat', class: 'water', requires: [['carFerry']] },
  passengerFerryBoat: { name: 'Passenger Ferry Boat', class: 'water', requires: [['passengerFerry']] },
  metalWhale: { name: 'Metal Whale', class: 'water', requires: [['area51'], ['marina']] },
  policeHelicopter: { name: 'Police Helicopter', class: 'air', requires: [['deluxePoliceStation']] },
  medicalHelicopter: { name: 'Medical Helicopter', class: 'air', requires: [['largeMedicalCenter']] },
  newsHelicopter: { name: 'News Helicopter', class: 'air', requires: [['televisionStudio']] },
  skyWriterPlane: { name: 'Sky Writer Plane', class: 'air', requires: [STRIPS] },
  cropDuster: { name: 'Crop Duster', class: 'air', requires: [STRIPS] },
  skyDiverPlane: { name: 'Sky Diver Plane', class: 'air', requires: [STRIPS] },
  firePlane: { name: 'Fire Plane', class: 'air', requires: [['fireLandingStrip']] },
  militaryHelicopter: { name: 'Military Helicopter', class: 'air', requires: [['armyBase']] },
  jetFighter: { name: 'Jet Fighter', class: 'air', requires: [['area51']] },
  ufo: { name: 'UFO', class: 'air', requires: [['area51']] },
} as const satisfies Record<string, VehicleDef>;

export type VehicleId = keyof typeof VEHICLES;

/** Training classes: road, rail and tank on land; plane and helicopter in the air; boats on water. */
export type TrainingClass = 'road' | 'rail' | 'tank' | 'plane' | 'helicopter' | 'boat';

/** Which training a vehicle needs before its missions open. */
export function trainingOf(id: VehicleId): TrainingClass {
  const v: VehicleDef = VEHICLES[id];
  if (id === 'tank') return 'tank';
  if (v.class === 'rail') return 'rail';
  if (v.class === 'water') return 'boat';
  if (v.class === 'air') return id === 'ufo' || v.name.includes('Helicopter') ? 'helicopter' : 'plane';
  return 'road';
}

/** Population conditions a mission can trigger on (total residents, shoppers' jobs, workers …). */
export type PopulationKey = 'R' | 'C' | 'I' | 'Cs$' | 'Cs$$' | 'Cs$$$' | 'Co$$' | 'Co$$$' | 'R$' | 'R$$' | 'R$$$' | 'IA' | 'ID' | 'IM' | 'IHT';

export interface MissionResult {
  /** Short-term Mayor Rating effect where the mission ends, and its radius in tiles. */
  mr: number;
  radius: number;
  cash: number;
  /** Rewards or deals unlocked outright. */
  unlocks?: readonly StructureKind[];
  /** One step towards a reward that takes several missions. */
  partial?: StructureKind;
}

export interface MissionDef {
  name: string;
  vehicle: VehicleId;
  /** Driven by any My Sim's own vehicle, whatever the wealth (`vehicle` is the § one). */
  anyMySim?: true;
  difficulty: 'easy' | 'medium' | 'hard';
  alignment: 'good' | 'evil' | 'neutral';
  triggers: {
    /** One structure from each group must stand. */
    structures?: readonly (readonly StructureKind[])[];
    /** Population above these numbers. */
    population?: Partial<Record<PopulationKey, number>>;
    /** At least `count` of these structures (e.g. three bus stops). */
    atLeast?: readonly { kinds: readonly StructureKind[]; count: number }[];
    /** Tiles of rail, monorail track, low-density homes or farms. */
    tiles?: Partial<Record<'rail' | 'monorail' | 'lowResidential' | 'agriculture', number>>;
    /** Lots (buildings) of a developer type. */
    lots?: Partial<Record<PopulationKey, number>>;
    /** A fire must be burning; a landfill zone must exist; there must be water. */
    fire?: boolean;
    landfill?: boolean;
    water?: boolean;
  };
  success: MissionResult;
  failure: MissionResult;
  /** May be played again after success (e.g. Fire!). */
  repeatable?: boolean;
  /**
   * A training mission: driven with any vehicle of this class, no
   * rewards; passing it opens that class's other missions.
   */
  training?: TrainingClass;
}

/** Rewards that take several mission successes. */
export const PARTIAL_UNLOCKS: Partial<Record<StructureKind, number>> = {
  deluxePoliceStation: 4,
  fireLandingStrip: 3,
  area51: 3,
  spacePort: 2,
};
