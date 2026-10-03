export type ResolutionResult={eligible:number;resolved:number};
export function resolveRecoveredIncidents(client:{query(sql:string,values?:unknown[]):Promise<{rows:Array<Record<string,unknown>>;rowCount?:number|null}>},options?:{apply?:boolean}):Promise<ResolutionResult>;
export function run(connectionString?:string,options?:{apply?:boolean}):Promise<ResolutionResult>;
