import { beforeEach,describe,it,expect } from 'vitest';
import { createBlankFlow } from '../packages/flow/src/index.js';
import { useBuilder } from '../apps/web/src/builder/store.js';

beforeEach(() => useBuilder.getState().replace(createBlankFlow(),true));
describe('AutoGen-derived graph history',() => {
  it('undoes and redoes both nodes and their configuration without shared references',() => {
    useBuilder.getState().add('input.buffer',{x:100,y:100});
    const id=useBuilder.getState().selectedId!;
    useBuilder.getState().update(id,{config:{windowSeconds:15}});
    useBuilder.getState().undo(); expect(useBuilder.getState().graph.nodes.find(node => node.id === id)!.config.windowSeconds).toBe(5);
    useBuilder.getState().redo(); expect(useBuilder.getState().graph.nodes.find(node => node.id === id)!.config.windowSeconds).toBe(15);
  });
  it('keeps history bounded and the cursor in bounds after more than fifty edits',() => {
    for(let index=0;index<80;index++) useBuilder.getState().update('start',{label:`Start ${index}`});
    expect(useBuilder.getState().history).toHaveLength(50); expect(useBuilder.getState().cursor).toBe(49);
    useBuilder.getState().undo(); expect(useBuilder.getState().graph.nodes[0]!.label).toBe('Start 78');
  });
  it('deleting a node removes its incident edges and is reversible',() => {
    useBuilder.getState().remove(['end']); expect(useBuilder.getState().graph.edges).toHaveLength(0);
    useBuilder.getState().undo(); expect(useBuilder.getState().graph).toEqual(createBlankFlow());
  });
  it('records an entire drag as one undoable action',() => {
    for(let x=0;x<20;x++) useBuilder.getState().move('start',{x,y:150});
    expect(useBuilder.getState().history).toHaveLength(1); useBuilder.getState().checkpoint();
    expect(useBuilder.getState().history).toHaveLength(2); useBuilder.getState().undo();
    expect(useBuilder.getState().graph.nodes[0]!.position).toEqual({x:80,y:160});
  });
  it('discards redo history after editing an older snapshot',() => {
    useBuilder.getState().update('start',{label:'A'}); useBuilder.getState().update('start',{label:'B'}); useBuilder.getState().undo(); useBuilder.getState().update('start',{label:'C'}); useBuilder.getState().redo();
    expect(useBuilder.getState().graph.nodes[0]!.label).toBe('C');
  });
});
