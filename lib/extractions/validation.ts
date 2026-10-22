import { z } from "zod";

function isCalendarDate(value: string) {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

const requiredDate = z.string().trim().min(1, "La fecha de finalización es obligatoria.").refine(isCalendarDate, "La fecha debe ser válida y tener formato DD/MM/AAAA.");
const requiredDevelopmentStart = z.string().trim().min(1, "La fecha de inicio del desarrollo es obligatoria.").refine(isCalendarDate, "La fecha debe ser válida y tener formato DD/MM/AAAA.");
const axCodeSchema = z.string()
  .regex(/^[A-Za-z0-9]{3,4}$/, "El código AX debe tener entre 3 y 4 caracteres alfanuméricos.")
  .transform((value) => value.toUpperCase());

const renaultVehicleSchema = z.object({
  manufacturerGroup: z.literal("Renault", { error: "Solo Renault esta disponible actualmente." }),
  brand: z.enum(["Renault", "Dacia"], { error: "Selecciona Renault o Dacia." }),
  modelDescription: z.string().trim().min(1, "La descripción es obligatoria.").max(200),
  modelCode: z.string().trim().min(1, "El código de modelo es obligatorio.").max(200),
});

const bmwVehicleSchema = z.object({
  manufacturerGroup: z.literal("BMW"),
  brand: z.enum(["BMW", "MINI"], { error: "Selecciona BMW o MINI." }),
  series: z.string().trim().min(1, "La serie es obligatoria.").max(100),
  developmentCode: z.string().trim().max(20, "El código de desarrollo es demasiado largo.").regex(/^[A-Z0-9]+$/, "El código de desarrollo solo admite letras mayúsculas y números."),
  typekey: z.string().trim().regex(/^[A-Z0-9]{4}$/, "El typekey debe tener 4 letras mayúsculas o números."),
  modelDescription: z.string().trim().max(200, "La descripción es demasiado larga."),
});

const vehiclesSchema = z.array(z.discriminatedUnion("manufacturerGroup", [renaultVehicleSchema, bmwVehicleSchema]))
  .min(1, "Añade al menos un vehículo.")
  .max(50, "No puedes añadir más de 50 vehículos.")
  .superRefine((vehicles, context) => {
    const groups = new Set(vehicles.map((vehicle) => vehicle.manufacturerGroup));
    if (groups.size > 1) context.addIssue({ code: "custom", message: "Una solicitud solo puede incluir vehículos de un mismo grupo.", path: [] });

    const brands = new Set(vehicles.map((vehicle) => vehicle.brand));
    if (brands.size > 1) context.addIssue({ code: "custom", message: "Una solicitud solo puede incluir un fabricante.", path: [] });

    const seenModels = new Set<string>();
    vehicles.forEach((vehicle, index) => {
      const identity = vehicle.manufacturerGroup === "BMW" ? vehicle.typekey : vehicle.modelCode;
      if (seenModels.has(identity)) {
        context.addIssue({ code: "custom", message: vehicle.manufacturerGroup === "BMW" ? "No repitas el mismo typekey de desarrollo." : "No repitas la misma familia en esta solicitud.", path: [index, vehicle.manufacturerGroup === "BMW" ? "typekey" : "modelCode"] });
      }
      seenModels.add(identity);
    });
  });

export const extractionFormSchema = z.object({
  axCode: axCodeSchema,
  imcEdition: z.string().trim().regex(/^\d{2}\/\d$/, "La edición debe tener el formato XX/X, por ejemplo 05/0."),
  completion: requiredDate,
  comments: z.string().trim().max(4_000, "Los comentarios son demasiado largos."),
  laboursDevelopmentStart: requiredDevelopmentStart,
  vehicles: vehiclesSchema,
});

export type ExtractionFormInput = z.infer<typeof extractionFormSchema>;
export type ExtractionVehicle = ExtractionFormInput["vehicles"][number];
