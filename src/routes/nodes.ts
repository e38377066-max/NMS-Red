import { Router, type IRouter } from "express";
import { sequelize, Node } from "../db";
import { CreateNodeBody, UpdateNodeBody, GetNodeParams, UpdateNodeParams, DeleteNodeParams } from "@workspace/api-zod";
const router: IRouter = Router();
const select = `SELECT n.id,n.name,n.location,n.role,n.created_at AS "createdAt",count(e.id)::int AS "equipmentCount"
 FROM nodes n LEFT JOIN equipment e ON e.node_id=n.id`;
router.get("/nodes", async (_req,res) => { const [rows] = await sequelize.query(`${select} GROUP BY n.id ORDER BY n.name`); res.json(rows); });
router.post("/nodes", async (req,res) => { const p=CreateNodeBody.safeParse(req.body); if(!p.success){res.status(400).json({error:p.error.message});return;} const node=await Node.create(p.data); res.status(201).json(node.get({plain:true})); });
router.get("/nodes/:id", async (req,res) => { const p=GetNodeParams.safeParse(req.params); if(!p.success){res.status(400).json({error:p.error.message});return;} const [rows]=await sequelize.query(`${select} WHERE n.id=:id GROUP BY n.id`,{replacements:{id:p.data.id}}); const row=(rows as any[])[0]; if(!row){res.status(404).json({error:"Node not found"});return;} res.json(row); });
router.patch("/nodes/:id", async (req,res) => { const p=UpdateNodeParams.safeParse(req.params), b=UpdateNodeBody.safeParse(req.body); if(!p.success){res.status(400).json({error:p.error.message});return;} if(!b.success){res.status(400).json({error:b.error.message});return;} const [count]=await Node.update(b.data,{where:{id:p.data.id}}); if(!count){res.status(404).json({error:"Node not found"});return;} res.json((await Node.findByPk(p.data.id))!.get({plain:true})); });
router.delete("/nodes/:id", async (req,res) => { const p=DeleteNodeParams.safeParse(req.params); if(!p.success){res.status(400).json({error:p.error.message});return;} const count=await Node.destroy({where:{id:p.data.id}}); if(!count){res.status(404).json({error:"Node not found"});return;} res.sendStatus(204); });
export default router;