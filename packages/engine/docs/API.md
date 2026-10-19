# City API

`new City(options)` 또는 `loadCity(save)`로 만든 도시의 공개 메서드 목록입니다. `src/city.ts`의 주석에서
`npm run docs`로 생성합니다(직접 고치지 마세요). 엔진은 Node·DOM API를 쓰지 않으므로 브라우저와 Cloudflare Workers에서 똑같이 동작합니다.

### `zone(x0: number, y0: number, x1: number, y1: number, kind: ZoneKind, opts: { autoStreets?: boolean } = {}): ToolResult`

Zones a rectangle. Like SC4, streets are drawn inside it automatically (unless `autoStreets` is false) so every lot gets frontage: residential and commercial lots are at most 2 deep, industry and farms reach 7 tiles.

### `previewZone(x0: number, y0: number, x1: number, y1: number, kind: ZoneKind, opts: { autoStreets?: boolean } = {}): { ok: boolean; cost: number; tiles: number; streets: [number, number][]; message?: string; cells: [number, number][]; }`

What zoning a rectangle would do, without doing it: the tiles that would be zoned, the auto-streets that would be laid, the cost, and why it can't be done (if so). For previews while dragging.

### `buildNetwork(x0: number, y0: number, x1: number, y1: number, kind: NetworkKind, opts: { lowBridge?: boolean } = {}): ToolResult`

Lays a network along an L-shaped path. Streets, roads and avenues upgrade each other in place; rail crosses them at level crossings; highways can't cross other networks (like SimCity 4's Ground Highway) and are reached by onramps.

### `previewNetwork(x0: number, y0: number, x1: number, y1: number, kind: NetworkKind, opts: { lowBridge?: boolean } = {}): { ok: boolean; cost: number; tiles: number; bridges: number; tunnels: number; message?: string; }`

What dragging a network would do, without doing it: the cost (with any direct ramps an avenue or highway adds), the tiles it builds or upgrades, bridges and tunnels, and why it can't be built (if so).

### `placeCloverleaf(x: number, y: number): ToolResult`

Puts a Cloverleaf on a ground highway tile so highways crossing there connect (§3,000, Rush Hour).

### `rename(name: string): ToolResult`

Renames the city (trimmed, up to 40 characters; an empty name is refused).

### `cheat(code: string): ToolResult & { cheat?: string }`

A console cheat: "you don't deserve it" makes every reward available, "fightthepower" and "howdryiam" lift the power and water requirements (again to restore them), "weaknesspays" adds §1,000 and "whererufrom" renames the city. Codes for the view (zots, the clock) are refused here.

### `renameBuilding(x: number, y: number, name: string): ToolResult`

Renames the building or structure on a tile (any building, from its Query box); an empty name clears it.

### `markHistorical(x: number, y: number, on = true): ToolResult`

Marks the RCI building on a tile Historical, or clears the mark (Rush Hour): it keeps its type and stage whatever happens to desirability, but can still be abandoned (then only its original type moves back in), burn or be bulldozed.

### `previewBulldoze(x0: number, y0: number, x1: number, y1: number): { ok: boolean; cost: number; buildings: number; structures: number; networkTiles: number; powerLines: number; rubble: number; lots: Rect[]; message?: string; }`

What bulldozing a rectangle would remove and cost, without doing it (for previews).

### `bulldoze(x0: number, y0: number, x1: number, y1: number): ToolResult`

—

### `clearRubble(preview = false): ToolResult & { tiles: number }`

Clears every rubble tile in the city at the bulldozer's price, and nothing else (a rectangle bulldozed over scattered rubble takes the roads and homes between). `preview` only prices it.

### `canPlaceStructure(kind: StructureKind, x: number, y: number): ToolResult`

Whether `kind` could be placed at (x, y) now, and why not (same checks as placeStructure).

### `roadBeside(x: number, y: number, w: number, h: number): boolean`

Does a road run beside the rectangle at grade (where garbage trucks, fire engines and buses reach a facility)? Without one its garbage piles up.

### `powerReach(kind: StructureKind, x: number, y: number): 'powered' | 'linked' | 'none'`

Whether a structure placed here would join a power grid: 'powered' when a conductor within reach (zone, building, power line) has power, 'linked' when one is in reach but unpowered, 'none' when nothing is (it would need a power line). As of the last refresh.

### `placeStructure(kind: StructureKind, x: number, y: number): ToolResult`

—

### `buildPowerLine(x0: number, y0: number, x1: number, y1: number): ToolResult`

Power lines along an L-shaped path; they may cross roads and water.

### `buildPipe(x0: number, y0: number, x1: number, y1: number): ToolResult`

Underground water pipes along an L-shaped path; they run under anything on land and stop at the water's edge.

### `bulldozePipes(x0: number, y0: number, x1: number, y1: number): ToolResult`

Removes pipes in a rectangle (the surface bulldozer leaves them alone).

### `buildSubway(x0: number, y0: number, x1: number, y1: number): ToolResult`

Subway track along an L-shaped path; it runs under anything, water included.

### `buildElevated(x0: number, y0: number, x1: number, y1: number, kind: 'elrail' | 'monorail' | 'highway'): ToolResult`

Elevated rail or monorail along an L-shaped path (Rush Hour). It runs over roads, rail, water and open land, but not over buildings or zones.

### `previewLine(kind: 'powerline' | 'pipe' | 'subway' | 'elrail' | 'monorail' | 'highway', x0: number, y0: number, x1: number, y1: number): { ok: boolean; cost: number; tiles: number; message?: string; }`

What dragging a line tool would build and cost, without building: power lines, pipes, subway or elevated track (with any ramps an elevated highway adds). Tiles already built are left out.

### `placeToll(x: number, y: number): ToolResult`

Puts a toll booth on a road, avenue or highway tile (Rush Hour).

### `bulldozeSubway(x0: number, y0: number, x1: number, y1: number): ToolResult`

Removes subway track in a rectangle (the surface bulldozer leaves it alone).

### `placeSubwayTransition(x: number, y: number): ToolResult`

Subway-to-Elevated Transition (Rush Hour): on a subway tile next to elevated rail, it lets trains run between the two.

### `setDepartmentFunding(dept: 'roads' | 'transit' | 'power' | 'water' | 'parks' | 'sanitation' | 'landmarks' | 'corrections', percent: number): void`

Road maintenance, mass transit, power line, water pipe or sanitation funding in percent (0–120); city beautification and landmarks 0–100 (can't overfund).

### `setFunding(structureId: number, percent: number): boolean`

Sets an individually funded civic building's level (plants 0–120%, health/education 0–150%); department-funded facilities return false. Zero-funded health/education and cargo facilities offer no jobs; reopening refreshes their commute routes.

### `setVehicleFunding(structureId: number, percent: number): boolean`

Local bus/ambulance funding of a school or hospital, 0–200% (scales its radius).

### `loanPayment(amount: number): number`

Monthly payment for a loan (amortized over 10 years at 8.5%, rounded down).

### `takeLoan(amount: number): ToolResult`

Borrows money (within the loan limits).

### `loanBalance(loan: { amount: number; monthsLeft: number }): number`

Principal still owed on a loan.

### `repayLoan(index: number): ToolResult`

Pays a loan off early (our own addition; the balance is the remaining principal).

### `ordinanceAvailable(id: OrdinanceId): boolean`

Can this ordinance be enacted now (some need a building or a road-served landfill first)?

### `ordinanceCost(id: OrdinanceId): number`

Monthly cost of an ordinance at the current population (negative = income).

### `enactOrdinance(id: OrdinanceId): ToolResult`

Enacts an ordinance if its prerequisite is met; its monthly cost or income is billed by the days it is in effect.

### `repealOrdinance(id: OrdinanceId): ToolResult`

Repeals an ordinance (repealing Legalized Gambling removes the Casino).

### `dispatch(kind: DispatchKind, x: number, y: number): ToolResult`

Sends the closest free fire or police unit to (x, y). Fire trucks need a road within eight tiles; planes and helicopters (Rush Hour) fly anywhere.

### `freeUnits(kind: DispatchKind, fit = false): number`

How many fire or police units are free to send right now; `fit`: only the crews automatic dispatch would send (an underfunded one fumbles).

### `throwMoney(x: number, y: number): ToolResult`

Mayor's Limo: throws §50 at the crowd for a short local Mayor Rating boost (needs the Mayor's House).

### `taxMoodOf(wealth: 0 | 1 | 2): number`

Mayor Rating effect of recent residential tax changes for a wealth level (0–2), as homes feel it.

### `mayorAt(x: number, y: number): MayorFactors | null`

Mayor Rating factors for the residential building at (x, y), if any.

### `isUnlocked(kind: StructureKind): boolean`

Reward buildings need their unlock condition met once; others are always available.

### `rewardProgress(): { kind: StructureKind; description: string; checks: UnlockCheck[] }[]`

Rewards not yet earned (the next tier for those earned in tiers) and where the city stands on each of their conditions. Business deals are offered rather than earned, so they are not listed.

### `takeNewUnlocks(): StructureKind[]`

Rewards and deals earned since the last call (for announcements).

### `placementsLeft(kind: StructureKind): number`

Copies of a structure the city may still place (Infinity when unlimited).

### `setTaxRate(type: DevType, rate: number): void`

Sets the tax rate (0–20%) for one of the twelve developer types (Rush Hour).

### `desirabilityMap(t: DevType): Float32Array`

Desirability of a type on every tile, zoned or not (for overlays). The simulation only keeps it for tiles zoned for that type.

### `batch<T>(fn: () => T): T`

Runs a series of edits with one refresh at the end instead of one per facility placed (building a town from a script, say). Returns `fn`'s result.

### `rngNow(): number`

The random generator's state as of now (what a save stores). Tools such as disaster() draw from it between days, after the state's copy was taken.

### `departmentUpkeep(dept: keyof CityState['departments'], level = this.state.departments[dept]): number`

What a department's budget pays a month at `level` percent (its own level by default), all else as it stands: the part of the month's spending its slider moves (garbage pickup, paid by the ton, left out).

### `structureUpkeep(id: number): { running: number; vehicles: number; overcapacity: number; total: number } | null`

A facility's monthly cost as the budget charges it (running, vehicles, a jail's overcrowding), or null.

### `infrastructureReport(): InfrastructureReport`

Power/water resilience per connected network, including loss of its largest single supply source. Empty pipe stubs are omitted; current load and funding are held constant.

### `previewGarbage(): CityState['garbageStats']`

Collection and disposal if the monthly tally ran under today's population, roads, funding, equipment and piles. Includes current contracts; future growth is not advanced. Does not change garbage, landfill contents, facility loads or random state.

### `refreshIfDirty(): void`

Recomputes fields if a tool changed the map since the last refresh.

### `query(x: number, y: number): TileInfo | null`

Everything about one tile: terrain, zone, networks, the building or structure on it, fields (pollution, crime, coverage, land value …), trip times and desirability by developer type with each factor.

### `step(days = 1): void`

Advances the simulation by `days` days.

### `beginSteps(days = 1): void`

Begins `days` days to be run a piece at a time with `resume` (a viewer runs a month's end across frames instead of freezing for it). Outcomes are exactly those of `step`. Public edits and tool previews finish pending days first; call `settle` before reading the state directly.

### `resume(): boolean`

Runs the days under way for one piece (a few ms of work); false once they are done.

### `settle(): void`

Finishes days under way: anything that reads the whole city or changes it must come after.

### `previewBudget(): BudgetReport`

Next month's budget if it were settled now: today's tax rates, budgets, ordinances and loans on last month's tax base and fares. Nothing is paid (it runs on a copy); the 재정 panel shows it beside last month's.

### `budgetForecast(months = 12, options: BudgetForecastOptions = {}): BudgetForecast`

Projects 1–120 months of cash and debt at today's tax base, operating costs, delivery conditions and contract prices, with loan maturities and deal grace/probation. Optional capital spending, tax-income and operating-cost scenarios change no city state; growth, ageing and disasters are left out.

### `addMySim(name: string, x: number, y: number): ToolResult & { sim?: MySim }`

Moves a new My Sim into the home at (x, y); its wealth is the home's.

### `moveMySim(id: number, x: number, y: number): ToolResult`

Change My Sim's House: only to a home of the Sim's own wealth.

### `setMySimJob(id: number, x: number, y: number): ToolResult`

Change My Sim's Job: a workplace with jobs for the Sim's wealth level.

### `removeMySim(id: number): boolean`

Evicts a My Sim.

### `mySimThoughts(id: number): Thought[]`

What a My Sim thinks about at home: local conditions, commute, stops, landmarks (green = approve).

### `interview(x: number, y: number, reach = 4): { wealth: 0 | 1 | 2; home: Rect; thoughts: Thought[] } | null`

Microphone tool (Rush Hour): an anonymous Sim from the nearest home within a few tiles of (x, y) says what they think of local conditions. Null when nobody lives nearby.

### `mySimCommute(id: number): { time: number; transit: boolean } | null`

The Sim's commute in centi-hours (−1: can't get there) and whether it uses transit.

### `dispatchMySim(id: number, x: number, y: number): Thought[]`

My Sims Dispatch: the Sim visits (x, y) and gives an opinion of it.

### `growthBlockers(x: number, y: number): GrowthBlocker[] | null`

Why an empty zoned tile hasn't developed, or why nobody moves back into an abandoned building: no power, no road, no demand, too little desirability … (null for anything else).

### `growthMap(): Uint8Array`

The main growth blocker of every empty zoned tile, for a data view: 0 where the tile isn't an empty zone, else 1 + its index in GROWTH_CODES (the first blocker found; dry land blocks only where every type that wants in needs water). Recomputed when the fields are.

### `stageOutlook(t: DevType): { population: number; maxStage: number; next: { stage: number; at: number } | null }`

How tall a type may build now (stage limits): its population (city plus region), the highest stage its table allows, and the population at which the next stage opens (null at the top).

### `understaffed(buildingId: number): boolean`

Is this business short of workers it can't get (under half its jobs filled while the Sims it mostly hires can't move in)? Such a building distresses and is abandoned for 'workforce'.

### `advisors(): Advice[]`

Advisors' messages: problems, news and successes by department.

### `ageProfile(): { from: number; residents: number; eq: number }[]`

Population by Age and Education by Age (bar graphs): residents and their average EQ in 10-year groups of household age (from 0–9 up).

### `opinionPolls(): Record<PollTopic, { approve: number; score: number }>`

City Opinion Polls: per topic, the share of residents who approve.

### `alightings(): Map<number, number>`

Riders who got off at each passenger station last month (station id → riders; boardings are its load).

### `routeQuery(x: number, y: number): RouteQuery`

Route Query: trips from, to or across (x, y), their routes and means.

### `availableMissions(): MissionId[]`

U-Drive-It missions that can be played now.

### `availableVehicles(): VehicleId[]`

Vehicles the city's structures make available.

### `startMission(id: MissionId): ActiveMission | ToolResult`

Starts a mission: where the vehicle starts, where it must get to, and the time allowed.

### `canDrive(vehicle: VehicleId, x: number, y: number): boolean`

May the vehicle move onto tile (x, y)?

### `vehicleAction(vehicle: VehicleId, action: 'spray' | 'shoot', x: number, y: number): ToolResult & { hits: number }`

U-Drive-It special controls that change the city. 'spray': the Fire Engine's crew (or the Fire Plane's water drop, wider) puts out fires on and beside the tile at full competence whatever the funding, and the Fire Engine neutralises toxic spills there. 'shoot': the Tank demolishes the building or structure on the tile, leaving rubble.

### `finishMission(id: MissionId, success: boolean, x: number, y: number): { cash: number; mr: number; unlocked: StructureKind[] }`

Ends the mission under way at (x, y): Mayor Rating effect there, cash, and any rewards it unlocks. Only a mission started with startMission, once.

### `abortMission(): boolean`

Surrenders the mission under way: no result either way (giving up spares the failure penalty).

### `takeMySimNews(): MySimNews[]`

My Sims who moved out or lost their job since the last call.

### `refresh(opts: { travel?: boolean } = {}): void`

Rebuilds all fields, desirability, census and demand, including network geometry after direct state-array edits. Normal tools need only `refreshIfDirty()`. `travel: false` keeps the last route plan (no network change; new workplaces join at the next plan).

### `connectionsPerEdge(): Record<ConnectionKind, [number, number, number, number]>`

Neighbour connections on each map edge (W, E, N, S) by kind, counting contiguous border runs once as demand relief does.

### `stats(): CityStats`

Citywide numbers: date, funds, population and jobs, utilities, garbage, safety, Mayor Rating, EQ and HQ.

### `powerDemand(): number`

Current power demand of every building (grid supply is updated at refresh).

### `waterDemand(): number`

Water every building and civic structure would use with full service.

### `unleash(kind: DisasterKind, x: number, y: number, intensity = 0.5): LiveDisaster | ToolResult`

Sets a tornado, Servo the robot or the Autosaurus loose at (x, y) to move over time: advanceDisasters() moves it a step (each simulated day moves it several), steerDisaster() pulls it towards a point. Other kinds strike at once (use disaster()).

### `steerDisaster(id: number, x: number, y: number): boolean`

Pulls a moving disaster towards (x, y) until released (click and hold, or drag).

### `releaseDisaster(id: number): boolean`

Lets a moving disaster roam on its own again.

### `advanceDisasters(steps = 1): LiveDisaster[]`

Moves every moving disaster `steps` steps; those that end file their damage report. Returns the ones still going.

### `disaster(kind: DisasterKind, x: number, y: number, intensity = 0.5): DamageReport`

Strikes a God Mode disaster at (x, y) at once (intensity 0–1) and returns its damage report; see unleash() to play moving ones out over time. Throws for unknown kinds or coordinates outside the map.

### `setNeighbour(edge: 0 | 1 | 2 | 3, kind: NeighbourKind, scale = 1, name?: string): void`

Sets the city beyond an edge (0 W, 1 E, 2 N, 3 S): SimNation, established, or developed at a size (0–100 times the template).

### `setNeighbourCity(edge: 0 | 1 | 2 | 3, snap: CitySnapshot | null, shared?: Neighbour['shared']): void`

Uses a real city's snapshot as the neighbour beyond an edge (regional play).

### `snapshot(): CitySnapshot`

How this city looks to its neighbours (population, employment, utilities, treasury).

### `receiveGrowth(growth: Partial<Record<DevType, number>>): void`

Growth other cities tossed to this one while it was inactive: it sprouts as extra demand until built. The region hands it over when it opens the city.

### `utility(resource: DealResource): Utility`

The city's own capacity, use and average cost of power, water or garbage disposal.

### `dealOffers(): DealOffer[]`

Every Neighbor Deal the city could strike now, with its maximum amount and price, or why not.

### `dealMonthly(d: Pick<NeighbourDeal, 'amount' | 'price' | 'direction' | 'resource'>): number`

What a deal (struck or offered, at an amount) pays or earns a month, ordinances included.

### `dealPriceFor(edge: 0 | 1 | 2 | 3, resource: DealResource, direction: 'buy' | 'sell', amount: number): number | null`

The unit price a deal for `amount` would be struck at (a smaller deal is priced lower), or null when it can't be.

### `makeDeal(edge: 0 | 1 | 2 | 3, resource: DealResource, direction: 'buy' | 'sell', amount?: number): ToolResult`

Strikes a Neighbor Deal (amount defaults to the maximum). It runs until cancelled or until a side can't keep it (grace, then probation).

### `cancelDeal(id: number): boolean`

Cancels a Neighbor Deal (no penalty).

### `takeRepricedDeals(): { deal: NeighbourDeal; was: number }[]`

Deals whose price was set again on their anniversary since the last call (with the old price).

### `takeEndedDeals(): NeighbourDeal[]`

—

### `takeRepealedOrdinances(): OrdinanceId[]`

Ordinances repealed since the last call because the building they need is gone.

### `takeReports(): DamageReport[]`

Damage reports since the last call (disasters, explosions, sinkholes, spills).

### `established(): boolean`

Has the city been founded: anything built or zoned yet? Until then the land is shaped for free, as before a city is established in SimCity 4 (afterwards terraforming is costly).

### `terraform(x0: number, y0: number, x1: number, y1: number, to: 'water' | 'land' | 'raise' | 'lower'): ToolResult`

Terrain tool: digs water or fills it in over a rectangle. Only open tiles change (no buildings, zones, networks or pipes).

### `previewTerraform(x0: number, y0: number, x1: number, y1: number, to: 'water' | 'land' | 'raise' | 'lower'): { ok: boolean; cost: number; tiles: number; message?: string }`

What a terraform drag would change and cost, without changing it (the tiles it can't touch left out).

### `previewTrees(x0: number, y0: number, x1: number, y1: number): { ok: boolean; cost: number; tiles: number; message?: string }`

What planting a rectangle would cost: open land only (see plantTrees).

### `plantTrees(x0: number, y0: number, x1: number, y1: number): ToolResult`

Plant Flora: saplings (§3 each) on open land in a rectangle. They grow for about four years, clean the air around them and, when planted, give the neighbourhood a small lift.

### `levelLandform(x0: number, y0: number, x1: number, y1: number): ToolResult`

Flattens volcano cones and slopes (and other scars) in a rectangle.

### `igniteAt(x: number, y: number): boolean`

Starts a fire on whatever stands at (x, y) (testing / disasters).
