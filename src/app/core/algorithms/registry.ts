import { AlgorithmDef } from '../models/algorithm.models';
import { dijkstraDef } from './dijkstra';
import { bellmanFordDef } from './bellman-ford';
import { astarDef } from './astar';
import { demoucronDef } from './demoucron';
import { demoucronCho } from './demoucron cho';

export const ALGORITHM_REGISTRY: AlgorithmDef[] = [
  demoucronDef,
  dijkstraDef,
  bellmanFordDef,
  astarDef,
  demoucronCho
];
