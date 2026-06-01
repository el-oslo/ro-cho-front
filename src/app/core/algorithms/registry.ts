import { AlgorithmDef } from '../models/algorithm.models';
import { dijkstraDef } from './dijkstra';
import { bellmanFordDef } from './bellman-ford';
import { astarDef } from './astar';
import { demoucronDef } from './demoucron';
import { demoucronChoDef } from './demoucron-cho';

export const ALGORITHM_REGISTRY: AlgorithmDef[] = [
  demoucronDef,
  demoucronChoDef,
  dijkstraDef,
  bellmanFordDef,
  astarDef,
];
