// U-Drive-It missions.

import type { MissionDef } from './udi';
import { LANDMARKS } from './rewards';

const POLICE = ['smallPoliceStation', 'largePoliceStation', 'deluxePoliceStation'] as const;
const DELUXE_POLICE = ['deluxePoliceStation'] as const;
const FIRE = ['smallFireStation', 'largeFireStation', 'fireLandingStrip'] as const;
const STRIPS = ['smallLandingStrip', 'mediumLandingStrip', 'largeLandingStrip'] as const;
const ELEMENTARY = ['elementarySchool', 'largeElementarySchool'] as const;
const HIGH_SCHOOL = ['highSchool', 'largeHighSchool'] as const;
const LARGE_MEDICAL = ['largeMedicalCenter'] as const;
const MAYORS_HOUSE = ['mayorsHouse'] as const;
const ARMY_BASE = ['armyBase'] as const;
const CEMETERY = ['cemetery'] as const;
const CASINO = ['casino'] as const;
const MARINA = ['marina'] as const;
const SEAPORT = ['internationalPort'] as const;
const AREA_51 = ['area51'] as const;
const TV_STATION = ['televisionStudio'] as const;
const FREIGHT_STATION = ['freightStation'] as const;
const TRAIN_STATION = ['trainStation'] as const;
const FERRY_TERMINAL = ['carFerry', 'passengerFerry'] as const;
const POWER_PLANTS = [
  'coalPlant', 'gasPlant', 'oilPlant', 'windPlant', 'solarPlant', 'nuclearPlant', 'hydrogenPlant',
  'wasteToEnergyPlant',
] as const;
const ANY_LANDMARK = Object.keys(LANDMARKS) as (keyof typeof LANDMARKS)[];

export const MISSIONS = {
  // Training missions (no alignment; they open the other missions of their vehicle type).
  trainingRoad: {
    name: 'Road Training', vehicle: 'policeCar', difficulty: 'easy', alignment: 'neutral', training: 'road',
    triggers: {}, success: { mr: 0, radius: 0, cash: 0 }, failure: { mr: 0, radius: 0, cash: 0 },
  },
  trainingRail: {
    name: 'Rail Training', vehicle: 'freightTrain', difficulty: 'easy', alignment: 'neutral', training: 'rail',
    triggers: {}, success: { mr: 0, radius: 0, cash: 0 }, failure: { mr: 0, radius: 0, cash: 0 },
  },
  trainingTank: {
    name: 'Tank Training Mission', vehicle: 'tank', difficulty: 'easy', alignment: 'neutral', training: 'tank',
    triggers: {}, success: { mr: 0, radius: 0, cash: 0 }, failure: { mr: 0, radius: 0, cash: 0 },
  },
  trainingPlane: {
    name: 'Plane Training', vehicle: 'cropDuster', difficulty: 'easy', alignment: 'neutral', training: 'plane',
    triggers: {}, success: { mr: 0, radius: 0, cash: 0 }, failure: { mr: 0, radius: 0, cash: 0 },
  },
  trainingHelicopter: {
    name: 'Helicopter Training', vehicle: 'policeHelicopter', difficulty: 'easy', alignment: 'neutral', training: 'helicopter',
    triggers: {}, success: { mr: 0, radius: 0, cash: 0 }, failure: { mr: 0, radius: 0, cash: 0 },
  },
  trainingBoat: {
    name: 'Boat Training', vehicle: 'motorBoat', difficulty: 'easy', alignment: 'neutral', training: 'boat',
    triggers: {}, success: { mr: 0, radius: 0, cash: 0 }, failure: { mr: 0, radius: 0, cash: 0 },
  },
  // ---------------------------------------------------------------- LAND
  aSpecialLoadOfGarbage: {
    name: 'A Special Load of Garbage', vehicle: 'garbageTruck', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [POLICE], population: { C: 1 }, landfill: true },
    success: { mr: -80, radius: 16, cash: 70_000, unlocks: ['toxicWasteDump'] },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  catchTheRobbers: {
    name: 'Catch the Robbers', vehicle: 'policeCar', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [POLICE], population: { C: 50 } },
    success: { mr: 110, radius: 32, cash: 40_000, partial: 'deluxePoliceStation' },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  copGoneBad: {
    name: 'Cop Gone Bad', vehicle: 'policeVan', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [DELUXE_POLICE], population: { 'Cs$': 100 } },
    success: { mr: 110, radius: 32, cash: 40_000 },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  // Difficulty and alignment assumed.
  drVuStealsABus: {
    name: 'Dr. Vu Steals a Bus', vehicle: 'cityBus', difficulty: 'medium', alignment: 'evil', // (−60 MR and §20,000 on success: Dr. Vu's side)
    triggers: { structures: [['busStop']], population: { R: 50 } },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  escapeWithTheLoot: {
    name: 'Escape with the Loot', vehicle: 'getawayVan', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [DELUXE_POLICE], population: { C: 50 } },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  disturbanceReported: {
    name: 'Disturbance Reported', vehicle: 'policeCar', difficulty: 'easy', alignment: 'good',
    triggers: { structures: [POLICE], population: { R: 50 } },
    success: { mr: 50, radius: 8, cash: 5_000, partial: 'deluxePoliceStation' },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  // Three successes unlock the Fire Department Landing Strip.
  fire: {
    name: 'Fire!', vehicle: 'fireEngine', difficulty: 'medium', alignment: 'good', repeatable: true,
    triggers: { structures: [FIRE], fire: true },
    success: { mr: 80, radius: 16, cash: 10_000, partial: 'fireLandingStrip' },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  drVuGetsATank: {
    name: 'Dr. Vu Gets a Tank', vehicle: 'tank', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [POLICE, MAYORS_HOUSE, ARMY_BASE], population: { R: 50 } },
    success: { mr: -80, radius: 16, cash: 70_000, unlocks: ['movieStudio'] },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  gooForTheMasses: {
    name: 'Goo for the Masses', vehicle: 'toxicWasteTruck', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [['toxicWasteDump']], population: { R: 100 } },
    success: { mr: -60, radius: 8, cash: 20_000, unlocks: ['cemetery'] },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  getLittleBinghamtonToSchool: {
    name: 'Get Little Binghamton to School', vehicle: 'schoolBus', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [ELEMENTARY], population: { R: 50 } },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['privateSchool'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  helpTheCats: {
    name: 'Help the Cats', vehicle: 'fireEngine', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [FIRE], population: { R: 500 } },
    success: { mr: 80, radius: 16, cash: 10_000 },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  getTheDeceasedToTheFuneral: {
    name: 'Get the Deceased to the Funeral', vehicle: 'hearse', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [CEMETERY], population: { R: 50 } },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['houseOfWorship'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  highRollerInTown: {
    name: 'High Roller in Town', vehicle: 'mayorsLimo', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [MAYORS_HOUSE] },
    success: { mr: -60, radius: 8, cash: 20_000, unlocks: ['casino'] },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  hijackTheTrain: {
    name: 'Hijack the Train', vehicle: 'passengerTrain', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [DELUXE_POLICE, TRAIN_STATION], tiles: { rail: 30 } },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  insaneTaxi: {
    name: 'Insane Taxi!!', vehicle: 'taxiCab', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [STRIPS], population: { R: 50 } },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  hoseDownTheCats: {
    name: 'Hose Down the Cats', vehicle: 'fireEngine', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [FIRE], population: { R: 500 } },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  // Also needs 1 § My Sim (covered by the vehicle).
  knockOverStore: {
    name: 'Knock Over Store', vehicle: 'mySimVehicle1', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [POLICE], population: { R: 1, 'Cs$': 1 } },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  iceCreamDelivery: {
    name: 'Ice Cream Delivery', vehicle: 'iceCreamTruck', difficulty: 'medium', alignment: 'good',
    triggers: { atLeast: [{ kinds: ELEMENTARY, count: 2 }] },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['stateFair'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  launchTime: {
    name: 'Launch Time', vehicle: 'armyTruck', difficulty: 'easy', alignment: 'good',
    triggers: { structures: [['missileRange'], ARMY_BASE] },
    success: { mr: 50, radius: 8, cash: 5_000 },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  mayorVisitsLandmark: {
    name: 'Mayor Visits Landmark', vehicle: 'mayorsLimo', difficulty: 'easy', alignment: 'good',
    triggers: { structures: [ANY_LANDMARK, MAYORS_HOUSE] },
    success: { mr: 50, radius: 8, cash: 5_000 },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  // Cs§§§ > 2 read as lots (like Run Some Errands' Cs§ lots > 2); My Sim §§§ covered by the vehicle.
  mySimGoesGiftShopping: {
    name: 'My Sim Goes Gift Shopping', vehicle: 'mySimVehicle3', difficulty: 'medium', alignment: 'evil',
    triggers: { population: { R: 500 }, lots: { 'Cs$$$': 2 } },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  mayorsGotNewSocks: {
    name: "Mayor's Got New Socks", vehicle: 'newsVan', difficulty: 'easy', alignment: 'good',
    triggers: { structures: [MAYORS_HOUSE, TV_STATION] },
    success: { mr: 50, radius: 8, cash: 5_000, unlocks: ['bureauOfBureaucracy'] },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  // Cs§§ > 2 read as lots (like Run Some Errands' Cs§ lots > 2); My Sim §§ covered by the vehicle.
  mySimGoesShopping: {
    name: 'My Sim Goes Shopping', vehicle: 'mySimVehicle2', difficulty: 'medium', alignment: 'good',
    triggers: { population: { R: 100 }, lots: { 'Cs$$': 2 } },
    success: { mr: 80, radius: 16, cash: 10_000 },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  monorailRide: {
    name: 'Monorail Ride', vehicle: 'monorailEngine', difficulty: 'easy', alignment: 'good',
    triggers: { atLeast: [{ kinds: ['monorailStation'], count: 2 }], tiles: { monorail: 20 } },
    success: { mr: 50, radius: 8, cash: 5_000, unlocks: ['solarPlant'] },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  // Any My Sim (§, §§ or §§§), in their own vehicle.
  mySimWantsToSee: {
    name: 'My Sim Wants to See…', vehicle: 'mySimVehicle1', anyMySim: true, difficulty: 'easy', alignment: 'good',
    triggers: { structures: [ANY_LANDMARK], population: { R: 1 } },
    success: { mr: 50, radius: 8, cash: 5_000 },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  nabTheCarJacker: {
    name: 'Nab the Car-jacker', vehicle: 'policeCar', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [POLICE] },
    success: { mr: 110, radius: 32, cash: 40_000, partial: 'deluxePoliceStation' },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  paparazzi: {
    name: 'Paparazzi', vehicle: 'newsVan', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [MAYORS_HOUSE, TV_STATION] },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  pureEvilIceCream: {
    name: 'Pure Evil Ice Cream', vehicle: 'iceCreamTruck', difficulty: 'medium', alignment: 'evil',
    triggers: { atLeast: [{ kinds: ELEMENTARY, count: 2 }] },
    success: { mr: -60, radius: 8, cash: 20_000, partial: 'area51' },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  newMissileTesting: {
    name: 'New Missile Testing', vehicle: 'tank', difficulty: 'easy', alignment: 'good',
    triggers: { structures: [ARMY_BASE] },
    success: { mr: 50, radius: 8, cash: 5_000, unlocks: ['missileRange'] },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  ribbonCuttingForMayor: {
    name: 'Ribbon Cutting for Mayor', vehicle: 'mayorsLimo', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [MAYORS_HOUSE], population: { C: 200 } },
    success: { mr: 80, radius: 16, cash: 10_000 },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  onTheTrail: {
    name: 'On the Trail', vehicle: 'policeCar', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [POLICE], population: { C: 100, R: 50 } },
    success: { mr: 80, radius: 16, cash: 10_000, partial: 'deluxePoliceStation' },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  runSomeErrands: {
    name: 'Run Some Errands', vehicle: 'mySimVehicle1', difficulty: 'medium', alignment: 'good',
    triggers: { population: { R: 1, 'Cs$': 50 }, lots: { 'Cs$': 2 } },
    success: { mr: 80, radius: 16, cash: 10_000 },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  shadyAmbulanceDriver: {
    name: 'Shady Ambulance Driver', vehicle: 'ambulance', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [LARGE_MEDICAL], population: { 'Cs$$': 50, 'Co$$': 50 } },
    success: { mr: -60, radius: 8, cash: 20_000, unlocks: ['courthouse'] },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  scientistLateForFlight: {
    name: 'Scientist Late for Flight', vehicle: 'taxiCab', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [STRIPS], population: { R: 50 } },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['operaHouse'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  shakedown: {
    name: 'Shakedown', vehicle: 'policeCar', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [POLICE], population: { 'Cs$': 100 } },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  sellSecretRocketFormula: {
    name: 'Sell Secret Rocket Formula', vehicle: 'steamTrain', difficulty: 'easy', alignment: 'evil',
    triggers: { structures: [FREIGHT_STATION, DELUXE_POLICE], tiles: { rail: 20 } },
    success: { mr: -40, radius: 4, cash: 10_000, partial: 'area51' },
    failure: { mr: -20, radius: 2, cash: -3_000 },
  },
  sickBusDriver: {
    name: 'Sick Bus Driver', vehicle: 'cityBus', difficulty: 'medium', alignment: 'good',
    triggers: { atLeast: [{ kinds: ['busStop'], count: 3 }] },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['conventionCenter'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  simlentOrange: {
    name: 'Simlent Orange', vehicle: 'hearse', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [CEMETERY], population: { C: 50 } },
    success: { mr: -60, radius: 8, cash: 20_000, unlocks: ['armyBase'] },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  studyForProfit: {
    name: 'Study for Profit', vehicle: 'schoolBus', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [HIGH_SCHOOL], atLeast: [{ kinds: ELEMENTARY, count: 2 }], population: { C: 50 } },
    success: { mr: -60, radius: 8, cash: 20_000, unlocks: ['nuclearPlant'] },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  slippedOnLlamaDung: {
    name: 'Slipped on Llama Dung', vehicle: 'ambulance', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [LARGE_MEDICAL], population: { C: 50 } },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['diseaseResearchLab'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  superSeatbeltFabricForSpaceShips: {
    name: 'Super Seatbelt Fabric for Space Ships!', vehicle: 'freightTrain', difficulty: 'easy', alignment: 'good',
    triggers: { atLeast: [{ kinds: FREIGHT_STATION, count: 2 }] },
    success: { mr: 50, radius: 8, cash: 5_000, partial: 'spacePort' },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  takeABreakAtTheCasino: {
    name: 'Take a Break at the Casino', vehicle: 'mySimVehicle3', difficulty: 'easy', alignment: 'good',
    triggers: { structures: [CASINO], population: { R: 1 } },
    success: { mr: 50, radius: 8, cash: 5_000 },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  stealAWarhead: {
    name: 'Steal a Warhead', vehicle: 'armyTruck', difficulty: 'easy', alignment: 'evil',
    triggers: { structures: [ARMY_BASE, DELUXE_POLICE] },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  tankJoyRide: {
    name: 'Tank Joy Ride', vehicle: 'tank', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [DELUXE_POLICE, ARMY_BASE] },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  trainRideForRocketFormula: {
    name: 'Train Ride for Rocket Formula', vehicle: 'steamTrain', difficulty: 'easy', alignment: 'good',
    triggers: { structures: [FREIGHT_STATION], tiles: { rail: 20 } },
    success: { mr: 50, radius: 8, cash: 5_000, partial: 'spacePort' },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  teachTheStrikersALesson: {
    name: 'Teach the Strikers a Lesson', vehicle: 'tank', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [ARMY_BASE], population: { C: 1 } },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  trainStationTour: {
    name: 'Train Station Tour', vehicle: 'freightTrain', difficulty: 'medium', alignment: 'good',
    triggers: { atLeast: [{ kinds: FREIGHT_STATION, count: 3 }], tiles: { rail: 20 } },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['grandRailroadStation'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  tookTheCasinoForABundle: {
    name: 'Took the Casino for a Bundle', vehicle: 'mySimVehicle3', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [CASINO], population: { R: 1 } },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  uncleVinnieAsksAFavor: {
    name: 'Uncle Vinnie Asks a Favor', vehicle: 'garbageTruck', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [POLICE], population: { C: 1 }, landfill: true },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['federalPrison'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  whistleStopTour: {
    name: 'Whistle Stop Tour', vehicle: 'passengerTrain', difficulty: 'medium', alignment: 'good',
    triggers: { atLeast: [{ kinds: TRAIN_STATION, count: 3 }], tiles: { rail: 20 } },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['touristTrap'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  whiteCollarCrime: {
    name: 'White Collar Crime', vehicle: 'mySimVehicle2', difficulty: 'hard', alignment: 'evil',
    triggers: { population: { R: 1, 'Cs$$': 1 } },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  youCanThrowMoneyAtIt: {
    name: 'You CAN Throw Money at It', vehicle: 'mayorsLimo', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [MAYORS_HOUSE], population: { C: 50 } },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['cityHall'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },

  // ---------------------------------------------------------------- SEA
  // "Car & Passenger Ferry Terminal": either ferry terminal.
  ferryOfEvil: {
    name: 'Ferry of Evil', vehicle: 'ferryBoat', difficulty: 'easy', alignment: 'evil',
    triggers: { structures: [FERRY_TERMINAL] },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  hereFishyFishyFishy: {
    name: 'Here Fishy, Fishy, Fishy', vehicle: 'fishingBoat', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [MARINA] },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['lighthouse'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  jetSkiFiesta: {
    name: 'Jet Ski Fiesta', vehicle: 'cigarBoat', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [MARINA] },
    success: { mr: 110, radius: 32, cash: 40_000 },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  mmmEndangeredDinner: {
    name: 'Mmm…Endangered Dinner', vehicle: 'fishingBoat', difficulty: 'easy', alignment: 'evil',
    triggers: { structures: [MARINA] },
    success: { mr: -60, radius: 8, cash: 20_000, unlocks: ['stockExchange'] },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  rxPickUpAndDelivery: {
    name: 'Rx Pick-Up and Delivery', vehicle: 'speedBoat', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [MARINA, SEAPORT] },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['resortHotel'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  rareFishViewing: {
    name: 'Rare Fish Viewing', vehicle: 'yacht', difficulty: 'easy', alignment: 'good',
    triggers: { structures: [MARINA] },
    success: { mr: 50, radius: 8, cash: 5_000, unlocks: ['countryClub'] },
    failure: { mr: -30, radius: 4, cash: -2_000 },
  },
  sos: {
    name: 'SOS', vehicle: 'tugBoat', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [MARINA] },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['majorArtMuseum'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  roboticWhaleDestruction: {
    name: 'Robotic Whale Destruction', vehicle: 'metalWhale', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [MARINA, SEAPORT, AREA_51] },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  waterEscape: {
    name: 'Water Escape', vehicle: 'motorBoat', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [DELUXE_POLICE, MARINA] },
    success: { mr: 80, radius: 16, cash: 10_000 },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  waterproofMindControlDevice: {
    name: 'Waterproof Mind Control Device', vehicle: 'speedBoat', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [MARINA, SEAPORT] },
    success: { mr: -60, radius: 8, cash: 20_000, unlocks: ['cruiseShipPort'] },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  // "Car and Passenger Ferry Terminal": either ferry terminal.
  whaleWatchingTour: {
    name: 'Whale Watching Tour', vehicle: 'ferryBoat', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [FERRY_TERMINAL] },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['marina'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },

  // ---------------------------------------------------------------- AIR
  blastORay: {
    name: 'Blast-O-Ray', vehicle: 'ufo', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [AREA_51], population: { R: 50, C: 50, I: 50 } },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  catchTheCrookFromTheAir: {
    name: 'Catch the Crook from the Air', vehicle: 'policeHelicopter', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [DELUXE_POLICE], population: { C: 50 } },
    success: { mr: 110, radius: 32, cash: 40_000, unlocks: ['televisionStudio'] },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  alienAbductionForFunAndProfit: {
    name: 'Alien Abduction for Fun and Profit', vehicle: 'ufo', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [AREA_51], population: { R: 50, C: 50, I: 50 } },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  coverTheHostageCrisis: {
    name: 'Cover the Hostage Crisis', vehicle: 'newsHelicopter', difficulty: 'medium', alignment: 'good',
    triggers: { population: { R: 50, C: 50 } },
    success: { mr: 80, radius: 16, cash: 10_000, unlocks: ['radioStation'] },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  crippleCityIndustrialComplex: {
    name: 'Cripple City Industrial Complex', vehicle: 'jetFighter', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [POWER_PLANTS, AREA_51], population: { I: 100 } },
    success: { mr: -80, radius: 16, cash: 70_000, unlocks: ['hydrogenPlant'] },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  getThePerpsStory: {
    name: "Get the Perp's Story", vehicle: 'newsHelicopter', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [TV_STATION], population: { C: 50 } },
    success: { mr: -60, radius: 8, cash: 20_000 },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  disturbingThePeace: {
    name: 'Disturbing the Peace', vehicle: 'policeHelicopter', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [DELUXE_POLICE], tiles: { lowResidential: 100 } },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  giveJennyAHandAndAHeart: {
    name: 'Give Jenny a Hand, and a Heart', vehicle: 'medicalHelicopter', difficulty: 'medium', alignment: 'good',
    triggers: { structures: [LARGE_MEDICAL], population: { R: 50 } },
    success: { mr: 80, radius: 16, cash: 10_000 },
    failure: { mr: -40, radius: 8, cash: -3_000 },
  },
  farmersGotVermin: {
    name: "Farmer's Got Vermin", vehicle: 'cropDuster', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [STRIPS], tiles: { agriculture: 50 } },
    success: { mr: 110, radius: 32, cash: 40_000, unlocks: ['farmersMarket'] },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  infiltrateDrVusSecretMeeting: {
    name: "Infiltrate Dr. Vu's Secret Meeting", vehicle: 'skyDiverPlane', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [STRIPS], population: { I: 50 } },
    success: { mr: 110, radius: 32, cash: 40_000 },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  letItBurn: {
    name: 'Let It Burn!', vehicle: 'firePlane', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [['fireLandingStrip']], fire: true },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  secretSkyCode: {
    name: 'Secret Sky Code', vehicle: 'skyWriterPlane', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [STRIPS] },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  // A major medical center is taken to mean the Large Medical Center.
  organsForProfit: {
    name: 'Organs for Profit', vehicle: 'medicalHelicopter', difficulty: 'medium', alignment: 'evil',
    triggers: { structures: [LARGE_MEDICAL], population: { I: 50 } },
    success: { mr: -60, radius: 8, cash: 20_000, unlocks: ['university'] },
    failure: { mr: -30, radius: 4, cash: -6_000 },
  },
  skydivingShowAt: {
    name: 'Skydiving Show at…', vehicle: 'skyDiverPlane', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [STRIPS, ANY_LANDMARK] },
    success: { mr: 110, radius: 32, cash: 40_000 },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  raidOnCity: {
    name: 'Raid on City', vehicle: 'militaryHelicopter', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [['trainStation', 'freightStation'], ARMY_BASE, MAYORS_HOUSE], water: true },
    success: { mr: -80, radius: 16, cash: 70_000 },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  spreadZombieDust: {
    name: 'Spread Zombie Dust', vehicle: 'cropDuster', difficulty: 'hard', alignment: 'evil',
    triggers: { structures: [STRIPS, CEMETERY] },
    success: { mr: -80, radius: 16, cash: 70_000, partial: 'area51' },
    failure: { mr: -40, radius: 8, cash: -10_000 },
  },
  takeOutDrVusSecretLair: {
    name: 'Take Out Dr. Vu\'s "Secret" Lair', vehicle: 'militaryHelicopter', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [ARMY_BASE], population: { I: 50 } },
    success: { mr: 110, radius: 32, cash: 40_000, unlocks: ['advancedResearchCenter'] },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  whoLovesYouBaby: {
    name: 'Who Loves You, Baby?', vehicle: 'skyWriterPlane', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [STRIPS] },
    success: { mr: 110, radius: 32, cash: 40_000, unlocks: ['majorLeagueStadium'] },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
  waterDropForFire: {
    name: 'Water Drop for Fire', vehicle: 'firePlane', difficulty: 'hard', alignment: 'good',
    triggers: { structures: [['fireLandingStrip']], fire: true },
    success: { mr: 110, radius: 32, cash: 40_000, unlocks: ['cityZoo'] },
    failure: { mr: -60, radius: 16, cash: -5_000 },
  },
} as const satisfies Record<string, MissionDef>;

export type MissionId = keyof typeof MISSIONS;

// Skipped missions:
// - Freedom of Expression (Land, Hard, Evil): needs a "Stolen Vehicle", which has no VehicleId.
