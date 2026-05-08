import express from "express";
import {
  getInconsistencies,
  getActiveInconsistencies,
  getItem,
  updateItem,
  refreshItem,
  createItem,
} from "../controllers/item.controller";

const router = express.Router();

router.get("/inconsistencies/all", getInconsistencies);
router.get("/inconsistencies/active", getActiveInconsistencies);

router.post("/debug/refresh/:id", refreshItem);

router.get("/:id", getItem);
router.put("/:id", updateItem);

router.post("/", createItem);

export default router;
