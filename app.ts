import express from "express";
import { router as index } from "./controller/index";
import { router as customers } from "./controller/customers";
import { router as order } from "./controller/order";
import cors from "cors";
export const app = express();
    
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.text());
app.use(express.json());

app.use("/", index);
app.use("/customers", customers);
app.use("/order", order);