function cG = calculateGeometricalCentre( part )
% cG = calculateGeometricalCentre( part )
% Calcula el centro geometrico de un aglomerado de partículas a partir de los centros
% geometricos de las particulas constituyentes
% 
% Argumentos de entrada:
% part:     Coordenadas x, y, z de las partículas constituyentes
%
% Argumentos de salida:
% cG:       Centro geometrico
%

if iscell( part )
    part = cell2mat( part );
end
part = part( :, 3 : 5 );
cG = mean( part, 1 );