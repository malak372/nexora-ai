import {
  extractApiData,
  normalUserApi,
} from "../../shared/api/normalUserApi";

export const getNormalUserSummary = async () => {
  const response = await normalUserApi.get("/users/summary");
  return extractApiData(response);
};
