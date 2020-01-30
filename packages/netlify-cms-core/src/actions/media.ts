import AssetProxy, { createAssetProxy } from '../valueObjects/AssetProxy';
import { Collection, State, EntryMap } from '../types/redux';
import { ThunkDispatch } from 'redux-thunk';
import { AnyAction } from 'redux';
import { isAbsolutePath } from 'netlify-cms-lib-util';
import { selectMediaFilePath } from '../reducers/entries';
import { selectMediaFileByPath } from '../reducers/mediaLibrary';
import { getMediaFile, waitForMediaLibraryToLoad, getMediaDisplayURL } from './mediaLibrary';
import { memoize } from 'lodash';

export const ADD_ASSETS = 'ADD_ASSETS';
export const ADD_ASSET = 'ADD_ASSET';
export const REMOVE_ASSET = 'REMOVE_ASSET';

export const LOAD_ASSET_REQUEST = 'LOAD_ASSET_REQUEST';
export const LOAD_ASSET_SUCCESS = 'LOAD_ASSET_SUCCESS';
export const LOAD_ASSET_FAILURE = 'LOAD_ASSET_FAILURE';

export function addAssets(assets: AssetProxy[]) {
  return { type: ADD_ASSETS, payload: assets };
}

export function addAsset(assetProxy: AssetProxy) {
  return { type: ADD_ASSET, payload: assetProxy };
}

export function removeAsset(path: string) {
  return { type: REMOVE_ASSET, payload: path };
}

export function loadAssetRequest(path: string) {
  return { type: LOAD_ASSET_REQUEST, payload: { path } };
}

export function loadAssetSuccess(path: string) {
  return { type: LOAD_ASSET_SUCCESS, payload: { path } };
}

export function loadAssetFailure(path: string, error: Error) {
  return { type: LOAD_ASSET_FAILURE, payload: { path, message: error.message } };
}

export function loadAsset(resolvedPath: string) {
  return async (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => {
    try {
      dispatch(loadAssetRequest(resolvedPath));
      // load asset url from backend
      await waitForMediaLibraryToLoad(dispatch, getState());
      const file = selectMediaFileByPath(getState(), resolvedPath);

      if (file) {
        const url = await getMediaDisplayURL(dispatch, getState(), file);
        const asset = createAssetProxy({ path: resolvedPath, url: url || resolvedPath });
        dispatch(addAsset(asset));
      } else {
        const { url } = await getMediaFile(getState(), resolvedPath);
        const asset = createAssetProxy({ path: resolvedPath, url });
        dispatch(addAsset(asset));
      }
      dispatch(loadAssetSuccess(resolvedPath));
    } catch (e) {
      dispatch(loadAssetFailure(resolvedPath, e));
    }
  };
}

interface GetAssetArgs {
  collection: Collection;
  entry: EntryMap;
  path: string;
}

const emptyAsset = (path: string) => createAssetProxy({ path, file: new File([], 'empty') });

export function memoizedGetAsset(dispatch: ThunkDispatch<State, {}, AnyAction>) {
  return (collection: Collection, entry: EntryMap) => {
    let asset: AssetProxy | null = null;

    // returns a new instance of getAsset every time the asset changes
    const boundGetAsset = memoize(
      () => (path: string) => {
        asset = dispatch(getAsset({ collection, entry, path }));
        return asset;
      },
      () => (asset ? asset.toString() : ''),
    )();

    return boundGetAsset;
  };
}

export function getAsset({ collection, entry, path }: GetAssetArgs) {
  return (dispatch: ThunkDispatch<State, {}, AnyAction>, getState: () => State) => {
    if (!path) return emptyAsset('');

    const state = getState();
    const resolvedPath = selectMediaFilePath(state.config, collection, entry, path);

    let asset = state.medias.get(resolvedPath);
    if (asset) {
      // There is already an AssetProxy in memory for this path. Use it.
      return asset;
    }

    // Create a new AssetProxy (for consistency) and return it.
    if (isAbsolutePath(resolvedPath)) {
      // asset path is a public url so we can just use it as is
      asset = createAssetProxy({ path: resolvedPath, url: path });
    } else {
      dispatch(loadAsset(resolvedPath));
      asset = emptyAsset(resolvedPath);
    }

    dispatch(addAsset(asset));

    return asset;
  };
}
