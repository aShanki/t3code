import Constants from "expo-constants";

/** A personally built fork: its own app id, no T3 Firebase push, local agent alerts. */
export const isPersonalFork = Constants.expoConfig?.extra?.personalFork === true;
